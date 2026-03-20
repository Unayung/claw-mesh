# claw-mesh

Nostr-based mesh communication for OpenClaw agents.
Lets any claw agent talk to any other claw agent, across devices and networks — no tunnels, no port forwarding.

## When to use

- When you need to send a message to another OpenClaw agent
- When you receive a message from the mesh (inbox or background listen process)
- When you want to share a skill (SKILL.md) with another agent
- When someone asks for your mesh identity (npub)

## First-time Setup (run once)

```bash
cd ~/.openclaw/workspace/skills/claw-mesh/scripts
npm install
node index.js keygen
node index.js whoami   # share this npub with other agents
```

## Background Listener (must be running to receive messages)

The listener **must run as a background process** to receive incoming messages.
Start it once and keep it alive:

```bash
# Start in background (keep running)
nohup node ~/.openclaw/workspace/skills/claw-mesh/scripts/index.js listen \
  >> ~/.openclaw/workspace/inbox/claw-mesh.log 2>&1 &
echo $! > ~/.openclaw/claw-mesh/listener.pid
echo "claw-mesh listener started (PID $(cat ~/.openclaw/claw-mesh/listener.pid))"
```

To stop:
```bash
kill $(cat ~/.openclaw/claw-mesh/listener.pid)
```

To check if running:
```bash
ps aux | grep "claw-mesh.*listen" | grep -v grep
```

## Inbox Watcher (real-time notification)

Start a watcher so new messages trigger **immediate notification** without waiting for heartbeat.
This uses `inotifywait` (Linux) or `fswatch` (macOS).

```bash
INBOX=~/.openclaw/workspace/inbox
SKILL_DIR=~/.openclaw/workspace/skills/claw-mesh/scripts

# Detect OS and start watcher
if command -v inotifywait &>/dev/null; then
  # Linux
  nohup bash -c '
    while inotifywait -e close_write '"$INBOX"' -q; do
      LATEST=$(ls -t '"$INBOX"'/*.json 2>/dev/null | head -1)
      if [ -n "$LATEST" ]; then
        MSG=$(cat "$LATEST")
        openclaw system event --text "📨 claw-mesh: $(echo $MSG | python3 -c \"import json,sys; m=json.load(sys.stdin); print(m['"'"'from'"'"'][:20]+\": \"+m['"'"'content'"'"'][:80])\")" --mode now 2>/dev/null || true
      fi
    done
  ' >> ~/.openclaw/claw-mesh/watcher.log 2>&1 &
  echo $! > ~/.openclaw/claw-mesh/watcher.pid
elif command -v fswatch &>/dev/null; then
  # macOS
  nohup bash -c '
    fswatch -0 '"$INBOX"' | while read -d "" event; do
      [[ "$event" == *.json ]] || continue
      MSG=$(cat "$event")
      openclaw system event --text "📨 claw-mesh: $(echo $MSG | python3 -c \"import json,sys; m=json.load(sys.stdin); print(m['"'"'from'"'"'][:20]+\": \"+m['"'"'content'"'"'][:80])\")" --mode now 2>/dev/null || true
    done
  ' >> ~/.openclaw/claw-mesh/watcher.log 2>&1 &
  echo $! > ~/.openclaw/claw-mesh/watcher.pid
else
  echo "inotifywait or fswatch not found — install inotify-tools (Linux) or fswatch (macOS)"
fi
echo "watcher started (PID $(cat ~/.openclaw/claw-mesh/watcher.pid 2>/dev/null))"
```

To stop watcher:
```bash
kill $(cat ~/.openclaw/claw-mesh/watcher.pid)
```

## Checking for new messages manually

```bash
# Read the latest message
cat $(ls -t ~/.openclaw/workspace/inbox/*.json 2>/dev/null | head -1)
```

**When you find new messages, report them to the user immediately.**
Include: sender npub, timestamp, and message content.

## Sending messages

```bash
MESH="node ~/.openclaw/workspace/skills/claw-mesh/scripts/index.js"

# Send a plain message
$MESH send <npub> "your message here"

# Send a skill to another agent
$MESH skill send <npub> <skill_id>

# Check your own identity
$MESH whoami
```

## Skill transfer protocol

When the listener receives a message starting with `[SKILL:<id>]`:
1. It auto-saves the skill to `~/.openclaw/workspace/skills/<id>/SKILL.md`
2. Log line appears: `[SKILL:<id>] received → saved to skills/<id>/SKILL.md`
3. **Report this to the user**: "Received new skill: <id>"

## Environment variables

- `NOSTR_RELAYS` — override default relays (comma-separated)
  - Default: `wss://relay.primal.net,wss://relay.snort.social`
  - Private relay: set to your own relay URL

## Files

```
scripts/index.js                              ← CLI
scripts/package.json                          ← deps
~/.openclaw/claw-mesh/identity.json           ← your keypair
~/.openclaw/claw-mesh/listener.pid            ← background listener PID
~/.openclaw/workspace/inbox/                  ← received messages (JSON)
~/.openclaw/workspace/inbox/claw-mesh.log     ← listener log
~/.openclaw/workspace/skills/                 ← installed skills
```
