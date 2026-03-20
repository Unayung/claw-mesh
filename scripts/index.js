#!/usr/bin/env node

import { useWebSocketImplementation } from 'nostr-tools/pool'
import WebSocket from 'ws'
useWebSocketImplementation(WebSocket)

import fs from 'node:fs'
import path from 'node:path'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'
import * as nip04 from 'nostr-tools/nip04'
import { SimplePool } from 'nostr-tools/pool'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

// ── Paths ──────────────────────────────────────────────────────────────────────
const HOME = process.env.HOME
const IDENTITY_DIR = path.join(HOME, '.openclaw', 'lobster-mesh')
const IDENTITY_FILE = path.join(IDENTITY_DIR, 'identity.json')
const INBOX_DIR = path.join(HOME, '.openclaw', 'workspace', 'inbox')
const SKILLS_DIR = path.join(HOME, '.openclaw', 'workspace', 'skills')

// ── Relays ─────────────────────────────────────────────────────────────────────
const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://relay.nostr.band']
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

async function listen() {
  const { sk, pk } = loadIdentity()
  ensureDir(INBOX_DIR)
  ensureDir(SKILLS_DIR)

  const pool = new SimplePool()
  console.log('Listening on relays:', RELAYS.join(', '))
  console.log('My pubkey:', nip19.npubEncode(pk))
  console.log('---')

  const sub = pool.subscribeMany(
    RELAYS,
    [{ kinds: [4], '#p': [pk], since: Math.floor(Date.now() / 1000) }],
    {
      async onevent(event) {
        try {
          const content = await nip04.decrypt(sk, event.pubkey, event.content)
          const senderNpub = nip19.npubEncode(event.pubkey)
          const ts = new Date(event.created_at * 1000).toISOString()

          // Check if this is a skill transfer
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

          // Write to inbox
          const inboxFile = path.join(INBOX_DIR, `${timestamp()}_${event.pubkey.slice(0, 8)}.json`)
          fs.writeFileSync(inboxFile, JSON.stringify({
            from: senderNpub,
            fromHex: event.pubkey,
            content,
            receivedAt: new Date().toISOString(),
            nostrEventId: event.id,
          }, null, 2))
        } catch (err) {
          console.error('Failed to decrypt message:', err.message)
        }
      },
      oneose() {
        console.log('(subscribed, waiting for messages...)')
      },
    },
  )

  // Keep alive
  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    sub.close()
    pool.close(RELAYS)
    process.exit(0)
  })
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
    console.log(`lobster-mesh — OpenClaw Nostr mesh agent

Commands:
  keygen              Generate identity keypair
  whoami              Show your npub
  listen              Listen for incoming messages
  send <npub> <msg>   Send a message to another lobster
  skill send <npub> <id>  Send a skill to another lobster`)
}
