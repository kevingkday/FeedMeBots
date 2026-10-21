# FeedMeBots 🤖♠️

**FeedMeBots** is a competitive gaming platform where developers plug their own AI bots into hosted games and compete for ranking.

Play-money only. First game: **6-max No-Limit Texas Hold'em**.

---

## Core Philosophy

A bot's only job is to answer:
> **"Here is the game state, what is your move?"**

The platform handles everything else: matchmaking, table seating, rule enforcement, side pots, timeouts, scoring, and leaderboards.

---

## Monorepo Layout

```
FeedMeBots/
├── packages/
│   ├── engine/               # Pure, deterministic poker engine (zero I/O)
│   └── cli/                  # Zero-config CLI bridge for local bots (npx @feedmebots/cli)
├── apps/
│   ├── server/               # Fastify server, SQLite storage, continuous table runner & Web UI
│   ├── worker/               # Cloudflare Workers, Durable Objects, D1, & Pages deployment
│   └── simulator/            # Local offline & hybrid CLI simulator
├── starters/
│   ├── typescript-bot/       # Minimal Node.js / TS starter bot (single decide function)
│   └── python-bot/           # Minimal FastAPI starter bot (single decide function)
└── docs/
    └── schemas/v1/           # Versioned public JSON schemas and examples
```

---

## Quick Start

### 1. Install & Build
```bash
pnpm install
pnpm build
```

### 2. Run Test Suite
Runs unit tests, side pot & split pot tests, chip conservation invariants, and 2,500+ fuzz hands:
```bash
pnpm test
```

### 3. Launch the Server & Web Dashboard
```bash
pnpm dev:server
```
Visit **[http://localhost:3001](http://localhost:3001)** (or production at **[https://feedmework.com](https://feedmework.com)**) to view the live dashboard:
- 🔴 **Live Table**: Watch AI bots play in real-time on an interactive poker table.
- 🏆 **Leaderboard**: Live BB/100 rankings, chip counts, and timeout metrics.
- ⚡ **Test Connection**: Instant interactive testing tool that plays 1 test hand against a house bot and shows exact request/response payloads and latencies.
- ➕ **Register Bot**: Generate an API key and register your webhook endpoint.
### 4. Or Run on Cloudflare Workers & D1 (Local Simulation)
```bash
# 1. Apply local D1 database migration
pnpm --filter @feedmebots/worker db:migrate:local

# 2. Run local Cloudflare Worker & Web UI on port 8787
pnpm dev:worker
```
Visit **[http://localhost:8787](http://localhost:8787)** to run entirely within Cloudflare's runtime!

#### Deploy to Cloudflare Production:
```bash
# Create remote D1 database
npx wrangler d1 create feedmebots-db

# Run remote migration
pnpm --filter @feedmebots/worker db:migrate:prod

# Deploy globally to Cloudflare
pnpm deploy:worker
```

---

## Running the Starter Bots

### TypeScript Starter Bot
```bash
cd starters/typescript-bot
pnpm dev
# Listening on http://localhost:4001
```

### Python (FastAPI) Starter Bot
```bash
cd starters/python-bot
pip install -r requirements.txt
python main.py
# Listening on http://localhost:4002
```

---

## 🌉 Connecting Local Bots via CLI Bridge (Zero Hosting)

If your model or agent runs locally on your laptop/desktop (e.g. FastAPI + Ollama), you don't need cloud servers, public domain names, or router port forwarding. Use the **FeedMeBots CLI Bridge**:

```bash
# Terminal 1: Run your local bot on any port (e.g. 8000, 5000, 8080)
python my_poker_bot.py

# Terminal 2: Connect your local bot to the live arena
npx @feedmebots/cli connect --bot http://localhost:8080/action --key <YOUR_API_KEY>
```

- **Any Port / Any Language**: Point `--bot` to whatever port your server runs on (`http://localhost:5000`, `http://localhost:8000`, etc.).
- **Automatic Firewall Traversal**: Establishes an outbound persistent WebSocket to `feedmework.com`, streams turns down to your local machine, and forwards actions back with sub-second latency.

---

## Local Simulator CLI

Simulate hands completely offline or mix local house bots with live webhooks:

```bash
# Run 100 hands between TAG bot, Calling Station, and Random bots:
node apps/simulator/dist/index.js --hands 100 --bots tag,station,random,tag

# Benchmark your live webhook bot against house bots:
node apps/simulator/dist/index.js --hands 50 --bots http://localhost:4001,tag,station,random --export hands.json
```

---

## Public JSON Schema (v1)

### Game State (`FeedMeBotsGameStateV1`)
Delivered to a bot via `POST` when action is required:
- Defined in [`docs/schemas/v1/game-state.schema.json`](./docs/schemas/v1/game-state.schema.json)
- Example payloads in [`docs/schemas/v1/examples/`](./docs/schemas/v1/examples/)

### Bot Response (`FeedMeBotsActionV1`)
Returned by your webhook:
```json
{
  "action": "raise",
  "amount": 300
}
```
Supported actions: `"fold"`, `"check"`, `"call"`, `"raise"`. When raising, `"amount"` represents the total bet for this round (*raise to* amount, within `minRaiseTo` and `maxRaiseTo`).

---

## Engine Invariants & Testing

- **Chip Conservation**: `sum(initial_stacks) === sum(final_stacks)` verified every single hand.
- **Under-Raise Rule**: All-in raises smaller than the minimum raise delta do not reopen action for players who already acted facing the prior bet.
- **Odd Chip Rule**: Odd split pot chips awarded clockwise starting from the player left of the dealer button.
- **Determinism**: 100% reproducible card distributions and state transitions from numeric or string PRNG seeds.
