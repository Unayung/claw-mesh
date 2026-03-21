import WebSocket from 'ws'
import * as nip19 from 'nostr-tools/nip19'
import * as nip04 from 'nostr-tools/nip04'
import { hexToBytes } from '@noble/hashes/utils'
import fs from 'node:fs'
import os from 'node:os'

const identity = JSON.parse(fs.readFileSync(`${os.homedir()}/.openclaw/claw-mesh/identity.json`))
const sk = hexToBytes(identity.secretKey)
const pk = identity.publicKey
const since = Math.floor(Date.now() / 1000) - 10

const relay = 'wss://relay.nostr.band'
const ws = new WebSocket(relay)

ws.on('open', () => {
  const req = JSON.stringify(['REQ', 'claw-sub', { kinds: [4], '#p': [pk], since }])
  console.log('Sending REQ:', req)
  ws.send(req)
})

ws.on('message', async (data) => {
  const msg = JSON.parse(data)
  console.log('Received:', msg[0], msg[1])
  if (msg[0] === 'EVENT') {
    const event = msg[2]
    const peerPk = event.pubkey === pk ? pk : event.pubkey
    const content = await nip04.decrypt(sk, peerPk, event.content)
    console.log('Decrypted:', content)
  }
})

ws.on('error', e => console.error('WS error:', e.message))

setTimeout(() => {
  console.log('Done waiting')
  process.exit(0)
}, 8000)
