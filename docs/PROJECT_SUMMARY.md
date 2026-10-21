# FeedMeBots: Competitive AI Bot Gaming Platform
## Technical Architecture, System Design & Assembly Summary

---

## 1. Executive Summary & Vision

**FeedMeBots** is a hosted, competitive benchmarking platform where software developers and AI researchers plug automated bot logic into live, rules-enforced games. 

The flagship game is **6-Max No-Limit Texas Hold’em** played as a **Sit & Go elimination tournament**:
- **Tournament Rules**: 6 players begin with equal starting stacks (10,000 chips; 60,000 chips in play). Stacks persist across hands until players bust. The tournament continues until one bot collects all 60,000 chips.
- **The Core Architectural Invariant**: A bot has exactly one responsibility:
  $$\text{decide}(\text{player\_game\_state}) \longrightarrow \text{action}$$
  Bots have zero knowledge of other players' hole cards, the deck sequence, or server internals. The platform manages all game orchestration, side pots, timers, legal action enforcement, and persistence.
- **Dual Execution Environments**:
  1. **Local / Self-Hosted Node.js Server**: Fastify + SQLite (`better-sqlite3`) + Dark-Mode Web Dashboard.
  2. **Global Serverless Cloudflare Edge**: Cloudflare Workers + Durable Objects (SQLite-backed) + D1 SQL Database + Static Assets.

---

## 2. Monorepo Structure & Assembly

The project is assembled as a high-performance **pnpm monorepo** with strict workspace boundaries, shared TypeScript configuration, and zero-I/O domain isolation:

```
FeedMeBots/
├── packages/
│   └── engine/               # Pure, deterministic poker engine (zero I/O)
│       ├── src/
│       │   ├── cards.ts       # 52-card primitives, suits, ranks, string parsers
│       │   ├── prng.ts        # Seeded Mulberry32 deterministic PRNG
│       │   ├── evaluator.ts   # 7-card evaluator (>1M hand evals/second)
│       │   ├── pots.ts        # Main & multiple side-pot calculations + refund logic
│       │   ├── rules.ts       # Legal action generator & min/max raise constraints
│       │   ├── bots.ts        # Built-in reference bots (TAG, Calling Station, Random)
│       │   └── engine.ts      # Pure state machine (createGame, step, getPlayerView)
│       └── test/              # 100% test suite, invariant checks, 2,500-hand fuzz tests
│
├── apps/
│   ├── server/               # Node.js backend (Fastify + SQLite + Web UI)
│   │   ├── src/
│   │   │   ├── db/            # SQLite schema, matches, hands, leaderboard repositories
│   │   │   ├── runner/        # TableRunner loop, bot webhook HTTP dispatcher
│   │   │   └── index.ts       # REST endpoints + static asset serving
│   │   └── public/            # Dark-mode Web UI dashboard (HTML5, Vanilla CSS, JS)
│   │
│   ├── simulator/            # High-throughput offline CLI simulator
│   │   └── src/index.ts       # Runs 10k+ hands between local/webhook bots; exports JSON
│   │
│   └── worker/               # Cloudflare Edge Deployment
│       ├── src/
│       │   ├── durable-objects/table-runner.ts  # Distributed TableRunner DO + WebSockets
│       │   └── index.ts                         # Hono edge router & D1 query API
│       ├── migrations/        # 0001_init.sql for Cloudflare D1
│       └── public/            # Static dashboard assets hosted on Cloudflare Workers Assets
│
├── starters/
│   ├── typescript-bot/       # Minimal Node.js HTTP starter bot
│   └── python-bot/           # Minimal FastAPI starter bot
│
├── docs/
│   ├── PROJECT_SUMMARY.md    # Architecture and Assembly overview
│   └── schemas/v1/           # JSON Schemas: game-state.schema.json, bot-action.schema.json
│
├── wrangler.toml             # Cloudflare Workers configuration (D1, DO, Assets)
└── pnpm-workspace.yaml       # Monorepo workspace configuration
```

---

## 3. Core Engine Design (`packages/engine`)

The engine is built to be completely deterministic, portable, and free of any filesystem or network I/O.

### A. Mulberry32 Deterministic PRNG
- Guarantees complete reproducibility: given the same numeric seed, hand deck distribution and shuffles are mathematically identical across Node.js, Cloudflare Workers, browser engines, or test runners.

### B. High-Speed 7-Card Evaluator
- Evaluates any 7-card combination in sub-microseconds without massive external lookup tables.
- Computes hand categories (High Card up to Royal Flush) and generates human-readable showdown descriptions (e.g., *"Full House, Kings full of Tens"*).

### C. Side Pot & Uncalled Bet Invariant
- Automatically creates main pots and split side pots when players have disparate stack sizes and go all-in.
- **Uncalled Bet Refund**: Correctly computes and returns uncalled bet increments before showdown (preventing chip leaks).
- **Odd Chip Allocation**: Follows official rules by distributing odd chips clockwise starting from the small blind / first active seat.
- **Conservation of Chips Invariant**: Validated across a 2,500-hand fuzz test suite ensuring that at every stage:
  $$\sum \text{Seat Stacks} + \sum \text{Active Bets} + \sum \text{Pots} = \text{Total Starting Chips (60,000)}$$

### D. Information Hiding & Player Views
- At any point in the hand, the engine generates a sanitized `PlayerGameStateV1` view for the active player:
  - Masked opponent hole cards (only showing `null`).
  - Revealing only community cards dealt so far.
  - Providing explicit lists of `legalActions` (e.g. `{ action: "call" }`, `{ action: "raise", minRaiseTo: 400, maxRaiseTo: 10000 }`).

---

## 4. Platform Runtime & Orchestration

### The Table Runner & Bot Dispatcher
1. **Match Lifecycle**: Registers up to 6 bots (human-submitted webhook URLs or built-in reference bots).
2. **Turn Dispatch**: Sends an HTTP `POST` to the active bot's endpoint with the sanitized game state.
3. **2000ms SLA Enforcement**: Each bot has up to 2.0 seconds to respond. If a bot times out or crashes:
   - The platform falls back safely: **Check** if free, otherwise **Fold**.
4. **Elimination Tracking**: When a bot's stack drops to `0`, its status changes to `eliminated`. The game progresses until a single winner holds all 60,000 chips.

---

## 5. Web UI & Live Dashboard

The dashboard provides a modern, dark-mode real-time interface:
- **Live 6-Max Poker Table**: Visual felt table with animated seat cards, dealer button marker, active bet badges, and dynamic community cards.
- **Live Pot Sync**: Center pot displays both settled pots and current in-flight street betting without lag.
- **Tournament Elimination Roster**: Stack health bars, in-hand markers, and eliminated badges.
- **Test Bench**: Interactive URL tester that executes a private simulated hand against a house bot to verify webhook compliance, action legality, and latency.
- **Leaderboard**: Win/loss stats, total hands played, and chip earnings.

---

## 6. Cloudflare Serverless Architecture

FeedMeBots is configured to run at the edge on Cloudflare:

```
[Incoming HTTP / WebSocket]
             │
             ▼
┌─────────────────────────┐
│ Cloudflare Worker       │  (Hono Router)
│ apps/worker/src/index.ts│
└────────────┬────────────┘
             │
      ┌──────┴────────────────────────┐
      ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│ Cloudflare D1 Database    │   │ Durable Object            │
│ (Persistent SQL Storage)  │   │ TableDurableObject        │
│                           │   │ - Real-time State Loop    │
│ - bots                    │   │ - WebSocket Hub           │
│ - matches                 │   │ - In-Memory Table Runner  │
│ - hands / hand_players    │   │ - SQLite Storage (`v1`)   │
│ - leaderboard             │   └───────────────────────────┘
└───────────────────────────┘
```

- **Cloudflare D1**: Serverless SQL database storing match results, hand histories, and bot registrations.
- **Durable Objects (`new_sqlite_classes`)**: Stateful, single-instance actor that maintains the live poker table, orchestrates bot webhook timeouts, and broadcasts real-time state to connected browser WebSockets.
- **Static Assets Binding (`[assets]`)**: Delivers the dashboard UI directly from the Cloudflare edge cache.

---

## 7. Connecting Custom AI Agents (Local RTX 5080 Workflow)

To connect a custom local AI model running on an **NVIDIA RTX 5080 (16GB VRAM)**:

1. **Local Model Server**: Run **Qwen 2.5 7B Instruct** or **Llama 3.1 8B Instruct** via Ollama using structured JSON schemas (`BotAction`).
2. **Cloudflare Tunnel (`cloudflared`)**: Expose the local FastAPI bot bridge to the internet without port forwarding:
   ```bash
   cloudflared tunnel --url http://localhost:8000
   ```
3. **Data Generation & Fine-Tuning**:
   - Use `apps/simulator` to generate 20,000+ tournament hands:
     ```bash
     pnpm dev:sim --hands 20000 --bots tag,tag,station,random --export data/hands.json
     ```
   - Extract positive-EV decisions and fine-tune using **Unsloth (QLoRA 4-bit)** on the RTX 5080 in ~15 minutes.
   - Export to GGUF format and load directly into Ollama for low-latency (<200ms) competitive play.
