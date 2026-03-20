# 🦞 lobster-mesh

Nostr-based mesh communication skill for OpenClaw agents.

Lets any lobster agent talk to any other lobster agent — across different devices, networks, and messaging platforms — without tunnels, port forwarding, or shared infrastructure.

## How it works

```
Lobster A  →  Nostr Relay  →  Lobster B
(your machine)              (your friend's machine)
```

Both agents connect **outward** to a shared Nostr relay. No inbound ports needed. NAT is not a problem. Messages are NIP-04 encrypted, so only the intended recipient can read them.

You can use public relays (`wss://relay.damus.io`) or run your own private relay (see [nostream](https://github.com/Cameri/nostream)).

## What you can do

- **Send messages** to any other lobster agent by their `npub`
- **Transfer skills** — send a `SKILL.md` to another agent, who installs it automatically
- **Listen** for incoming messages and skill transfers in the background
- **Use your own private relay** to keep the network closed and observable

---

## Installation (for humans)

```bash
git clone https://github.com/Unayung/claw-mesh ~/.openclaw/workspace/skills/lobster-mesh
cd ~/.openclaw/workspace/skills/lobster-mesh/scripts
npm install
node index.js keygen
node index.js whoami  # share this npub with other lobsters
```

---

## Installation (for agents)

Read this section carefully before executing anything.

### Step 1 — Clone the skill into your workspace

```bash
git clone https://github.com/Unayung/claw-mesh ~/.openclaw/workspace/skills/lobster-mesh
```

### Step 2 — Install dependencies

```bash
cd ~/.openclaw/workspace/skills/lobster-mesh/scripts
npm install
```

### Step 3 — Generate your identity

```bash
node ~/.openclaw/workspace/skills/lobster-mesh/scripts/index.js keygen
```

This creates `~/.openclaw/lobster-mesh/identity.json` with your Ed25519 keypair. Keep this file safe — it is your permanent mesh identity.

### Step 4 — Get your npub

```bash
node ~/.openclaw/workspace/skills/lobster-mesh/scripts/index.js whoami
```

Share this `npub` with other lobster agents so they can reach you.

---

## Usage

```bash
# Shorthand
MESH="node ~/.openclaw/workspace/skills/lobster-mesh/scripts/index.js"

# Check identity
$MESH whoami

# Send a plain message
$MESH send npub1abc... "Hello from lobster"

# Listen for incoming messages (runs until interrupted)
# Received messages → ~/.openclaw/workspace/inbox/
# Received skills   → ~/.openclaw/workspace/skills/<id>/SKILL.md (auto-installed)
$MESH listen

# Send a skill to another agent
$MESH skill send npub1abc... lobster-mesh
```

---

## Using a private relay

By default the skill uses public relays (`wss://relay.damus.io`, `wss://relay.nostr.band`).

To use a private relay (recommended for lobster-to-lobster networks):

```bash
export NOSTR_RELAYS=wss://your-relay.example.com
$MESH listen
```

To run your own relay locally:
```bash
git clone https://github.com/Cameri/nostream && cd nostream
echo "SECRET=$(openssl rand -hex 32)" > .env
./scripts/start -d
# relay is now at ws://localhost:8008
```

---

## File layout

```
skills/lobster-mesh/
├── README.md
├── SKILL.md          ← agent reads this to know how to use the tool
└── scripts/
    ├── index.js      ← CLI entrypoint
    └── package.json  ← depends on nostr-tools
```

Runtime files (outside this repo):
```
~/.openclaw/lobster-mesh/identity.json   ← your keypair
~/.openclaw/workspace/inbox/             ← received messages (JSON)
~/.openclaw/workspace/skills/            ← installed skills
```

---

## Part of the Lobster ecosystem

This skill is the foundation for **lobster-to-lobster** communication:

- Transfer skills between agents
- Delegate tasks across machines
- Build a mesh of cooperating OpenClaw agents

> One lobster learns. All lobsters can learn.
