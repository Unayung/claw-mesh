#!/usr/bin/env node

import { useWebSocketImplementation } from 'nostr-tools/pool'
import WebSocket from 'ws'
useWebSocketImplementation(WebSocket)

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import * as nip04 from 'nostr-tools/nip04'
import { SimplePool } from 'nostr-tools/pool'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

// ── Paths ──────────────────────────────────────────────────────────────────────
const HOME = os.homedir()
const IDENTITY_DIR = path.join(HOME, '.openclaw', 'claw-mesh')
const IDENTITY_FILE = path.join(IDENTITY_DIR, 'identity.json')
const INBOX_DIR = path.join(HOME, '.openclaw', 'workspace', 'inbox')
const SKILLS_DIR = path.join(HOME, '.openclaw', 'workspace', 'skills')

// ── Relays ─────────────────────────────────────────────────────────────────────
const DEFAULT_RELAYS = ['wss://relay.primal.net', 'wss://relay.snort.social']
const RELAYS = process.env.NOSTR_RELAYS
  ? process.env.NOSTR_RELAYS.split(',').map(r => r.trim())
  : DEFAULT_RELAYS

// ── Helpers ────────────────────────────────────────────────────────────────────
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function loadIdentity() {
  if (!fs.existsSync(IDENTITY_FILE)) {
    console.error('No identity found. Run: node index.js keygen')
    process.exit(1)
  }
  const data = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf-8'))
  return {
    sk: hexToBytes(data.secretKey),
    pk: data.publicKey,
  }
}

function decodePubkey(npubOrHex) {
  if (npubOrHex.startsWith('npub')) {
    const { type, data } = nip19.decode(npubOrHex)
    if (type !== 'npub') throw new Error('Invalid npub')
    return data
  }
  return npubOrHex
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

// ── Commands ───────────────────────────────────────────────────────────────────

function keygen() {
  ensureDir(IDENTITY_DIR)
  if (fs.existsSync(IDENTITY_FILE)) {
    console.error('Identity already exists at', IDENTITY_FILE)
    console.error('Delete it first if you want to regenerate.')
    process.exit(1)
  }
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)
  const identity = {
    secretKey: bytesToHex(sk),
    publicKey: pk,
    npub: nip19.npubEncode(pk),
    createdAt: new Date().toISOString(),
  }
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2))
  console.log('Identity generated!')
  console.log('npub:', identity.npub)
  console.log('Saved to:', IDENTITY_FILE)
}

function whoami() {
  const { pk } = loadIdentity()
  const npub = nip19.npubEncode(pk)
  console.log(npub)
}

async function handleEvent(event, sk, pk) {
  try {
    const peerPk = event.pubkey === pk ? pk : event.pubkey
    const content = await nip04.decrypt(sk, peerPk, event.content)
    const senderNpub = nip19.npubEncode(event.pubkey)
    const ts = new Date(event.created_at * 1000).toISOString()

    const skillMatch = content.match(/^\[SKILL:([^\]]+)\]\n([\s\S]*)$/)
    if (skillMatch) {
      const skillId = skillMatch[1]
      const skillContent = skillMatch[2]
      const skillDir = path.join(SKILLS_DIR, skillId)
      ensureDir(skillDir)
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent)
      console.log(`[${ts}] ${senderNpub}: [SKILL:${skillId}] received → saved to skills/${skillId}/SKILL.md`)
    } else {
      console.log(`[${ts}] ${senderNpub}: ${content}`)
    }

    ensureDir(INBOX_DIR)
    const inboxFile = path.join(INBOX_DIR, `${timestamp()}_${event.pubkey.slice(0, 8)}.json`)
    fs.writeFileSync(inboxFile, JSON.stringify({
      from: senderNpub, fromHex: event.pubkey, content,
      receivedAt: new Date().toISOString(), nostrEventId: event.id,
    }, null, 2))
  } catch (err) {
    console.error('Failed to decrypt message:', err.message)
  }
}

async function listen() {
  const { sk, pk } = loadIdentity()
  ensureDir(INBOX_DIR)
  ensureDir(SKILLS_DIR)

  console.log('Listening on relays:', RELAYS.join(', '))
  console.log('My pubkey:', nip19.npubEncode(pk))
  console.log('---')

  const since = Math.floor(Date.now() / 1000) - 30
  const filter = { kinds: [4], '#p': [pk], since }
  const seenIds = new Set()

  // Use raw WebSocket to avoid SimplePool filter wrapping bug
  for (const relayUrl of RELAYS) {
    const ws = new WebSocket(relayUrl)
    ws.on('open', () => {
      // Nostr REQ: ["REQ", <sub-id>, <filter>] — filter must NOT be wrapped in array
      ws.send(JSON.stringify(['REQ', `claw-${Date.now()}`, filter]))
    })
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data)
        if (msg[0] === 'EOSE') {
          console.log(`(subscribed to ${relayUrl})`)
        } else if (msg[0] === 'EVENT') {
          const event = msg[2]
          if (!seenIds.has(event.id)) {
            seenIds.add(event.id)
            await handleEvent(event, sk, pk)
          }
        } else if (msg[0] === 'NOTICE') {
          if (msg[1]?.includes('ERROR')) console.error(`[${relayUrl}] NOTICE: ${msg[1]}`)
        }
      } catch (e) { /* ignore parse errors */ }
    })
    ws.on('error', (e) => console.error(`[${relayUrl}] error:`, e.message))
    ws.on('close', () => console.log(`[${relayUrl}] disconnected`))
  }

  process.on('SIGINT', () => { console.log('\nShutting down...'); process.exit(0) })

  // Keep alive
  await new Promise(() => {})
}

async function send(targetNpub, message) {
  const { sk, pk } = loadIdentity()
  const targetPk = decodePubkey(targetNpub)

  const pool = new SimplePool()
  const encrypted = await nip04.encrypt(sk, targetPk, message)

  const event = finalizeEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', targetPk]],
    content: encrypted,
  }, sk)

  console.log('Publishing to relays:', RELAYS.join(', '))
  await Promise.any(pool.publish(RELAYS, event))
  console.log('Sent!')
  console.log('Event ID:', event.id)
  pool.close(RELAYS)
}

async function skillSend(targetNpub, skillId) {
  const skillFile = path.join(SKILLS_DIR, skillId, 'SKILL.md')
  if (!fs.existsSync(skillFile)) {
    console.error(`Skill not found: ${skillFile}`)
    process.exit(1)
  }
  const skillContent = fs.readFileSync(skillFile, 'utf-8')
  const message = `[SKILL:${skillId}]\n${skillContent}`
  await send(targetNpub, message)
  console.log(`Skill "${skillId}" sent successfully.`)
}

// ── Session Delivery ───────────────────────────────────────────────────────────
function deliverToLastActiveSession(text, execSync) {
  try {
    const sessionsFile = path.join(HOME, '.openclaw', 'agents', 'main', 'sessions', 'sessions.json')
    if (!fs.existsSync(sessionsFile)) return false
    const data = JSON.parse(fs.readFileSync(sessionsFile, 'utf-8'))

    // Real channel patterns to look for (most specific first)
    const CHANNEL_PATTERNS = [
      /^agent:main:telegram:direct:/,
      /^agent:main:whatsapp:/,
      /^agent:main:discord:channel:/,
      /^agent:main:signal:/,
      /^agent:main:telegram:group:/,
    ]
    const SKIP = ['cron', 'subagent', 'tui', 'openai-user']

    // Find most recently updated real channel session
    let best = null
    let bestTime = 0
    for (const [k, v] of Object.entries(data)) {
      if (SKIP.some(s => k.includes(s))) continue
      if (!CHANNEL_PATTERNS.some(p => p.test(k))) continue
      if ((v.updatedAt ?? 0) > bestTime) {
        bestTime = v.updatedAt ?? 0
        best = { key: k, sessionId: v.sessionId }
      }
    }

    // If no channel session found, fall back to main session with --deliver
    // which routes to the last active channel via OpenClaw's own routing
    const sessionId = best?.sessionId
    if (sessionId) {
      execSync(`openclaw agent --session-id ${sessionId} --message ${JSON.stringify(text)} --deliver`, { stdio: 'ignore' })
    } else {
      execSync(`openclaw agent --message ${JSON.stringify(text)} --deliver`, { stdio: 'ignore' })
    }
    return true
  } catch {
    return false
  }
}

// ── Inbox Watcher ──────────────────────────────────────────────────────────────
// Pure Node.js fs.watch — works on macOS and Linux without any extra tools
async function watchInbox() {
  ensureDir(INBOX_DIR)
  const { execSync } = await import('node:child_process')

  console.log(`Watching inbox: ${INBOX_DIR}`)
  console.log('Will notify via openclaw system event when new messages arrive.')
  console.log('---')

  const seen = new Set(fs.readdirSync(INBOX_DIR).filter(f => f.endsWith('.json')))

  fs.watch(INBOX_DIR, (eventType, filename) => {
    if (!filename?.endsWith('.json')) return
    if (seen.has(filename)) return
    seen.add(filename)

    setTimeout(() => {
      try {
        const filepath = path.join(INBOX_DIR, filename)
        if (!fs.existsSync(filepath)) return
        const msg = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
        const from = msg.from?.slice(-16) ?? 'unknown'
        const content = (msg.content ?? '').slice(0, 80)
        const text = `📨 claw-mesh: ${from}: ${content}`
        console.log(`[notify] ${text}`)
        // Find last active real channel session and deliver there
        const delivered = deliverToLastActiveSession(text, execSync)
        if (!delivered) {
          try {
            execSync(`openclaw system event --text ${JSON.stringify(text)} --mode now`, { stdio: 'ignore' })
          } catch { /* ignore */ }
        }
      } catch (e) {
        console.error('watcher error:', e.message)
      }
    }, 200) // small delay to ensure file is fully written
  })

  process.on('SIGINT', () => { console.log('\nStopped watching.'); process.exit(0) })
  await new Promise(() => {})
}

// ── CLI Router ─────────────────────────────────────────────────────────────────
const [,, cmd, ...args] = process.argv

switch (cmd) {
  case 'keygen':
    keygen()
    break
  case 'whoami':
    whoami()
    break
  case 'listen':
    await listen()
    break
  case 'watch':
    await watchInbox()
    break
  case 'send':
    if (args.length < 2) {
      console.error('Usage: node index.js send <npub> <message>')
      process.exit(1)
    }
    await send(args[0], args.slice(1).join(' '))
    break
  case 'skill':
    if (args[0] === 'send' && args.length >= 3) {
      await skillSend(args[1], args[2])
    } else {
      console.error('Usage: node index.js skill send <npub> <skill_id>')
      process.exit(1)
    }
    break
  default:
    console.log(`claw-mesh — OpenClaw Nostr mesh agent

Commands:
  keygen              Generate identity keypair
  whoami              Show your npub
  listen              Listen for incoming messages
  send <npub> <msg>   Send a message to another claw agent
  skill send <npub> <id>  Send a skill to another claw agent`)
}
