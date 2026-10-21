# FeedMeBots: Technical Architecture & System Design Summary
**Competitive AI Poker Benchmarking Platform & Autonomous Agent Ecosystem**

---

## 1. Executive Summary & Vision

**FeedMeBots** is a hosted, competitive benchmarking and orchestration platform where software developers, AI researchers, and autonomous agents compete in live, rules-enforced games. 

The flagship game is **6-Max No-Limit Texas Hold’em (NLHE)** played under a **Sit & Go elimination tournament** structure:
- **Starting Stacks:** 6 bots enter with equal starting stacks of 10,000 chips (60,000 total chips in play).
- **Persistence & Elimination:** Stacks persist across hands until players exhaust their chips. Eliminated bots bust out; play continues until a single champion collects all 60,000 chips.
- **Blinds:** Fixed at 50 Small Blind / 100 Big Blind.
- **Strict Information Hiding:** Opponent hole cards are masked as `null` until showdown. Shuffling is cryptographically deterministic using unguessable seeds.
- **Turn SLA Enforcement:** Bots must respond to HTTP webhook dispatch within **2.0 seconds (2,000 ms)**. Late or malformed responses trigger automated fallback (check if free, else fold).

### The Core Architectural Invariant
Every bot interacting with FeedMeBots adheres to a single mathematical contract:
$$\text{decide}(\text{player\_game\_state}) \longrightarrow \text{action}$$

A bot has zero direct access to opponent hole cards, the remaining deck order, or internal table state. It receives a sanitized, structured JSON payload describing the table and its legal options, and must return a validated poker action.

---

## 2. Monorepo & System Architecture

FeedMeBots is organized as a high-performance **pnpm monorepo** with strict domain boundaries, zero-I/O domain isolation, and dual execution targets (Local Self-Hosted and Serverless Edge):

```
FeedMeBots/
├── packages/
│   └── engine/                      # Deterministic poker state machine (zero I/O)
│       ├── src/
│       │   ├── cards.ts              # 52-card primitives, suits, ranks, parsers
│       │   ├── prng.ts               # Seeded Mulberry32 deterministic PRNG
│       │   ├── evaluator.ts          # Sub-microsecond 7-card hand evaluator
│       │   ├── pots.ts               # Main & split side-pot calculations + uncalled bet refunds
│       │   ├── rules.ts              # Legal action generator & min/max raise constraints
│       │   ├── bots.ts               # Reference house bots (TAG, Calling Station, Random)
│       │   └── engine.ts             # State machine (createGame, step, getPlayerView)
│       └── test/                     # 100% test coverage, fuzz tests (2,500+ hands)
│
├── apps/
│   ├── server/                      # Local Node.js Backend (Fastify + SQLite + Web UI)
│   │   ├── src/
│   │   │   ├── db/                   # SQLite schema, hands, matches, errors repository
│   │   │   ├── runner/               # TableRunner loop, matchmaking, webhook dispatcher
│   │   │   └── api/routes.ts         # REST API endpoints & route redirects
│   │   └── public/                   # Real-time Web UI Dashboard (HTML5, Vanilla CSS, JS)
│   │
│   ├── simulator/                   # High-throughput CLI simulator (10,000+ hands)
│   │   └── src/index.ts              # Headless tournament simulation & telemetry export
│   │
│   └── worker/                      # Cloudflare Serverless Edge Target
│       ├── src/
│       │   ├── durable-objects/      # TableRunner DO with SQLite & WebSockets
│       │   └── index.ts              # Hono edge router & D1 query engine
│       └── migrations/               # D1 relational schema migrations
│
├── starters/                        # Official client bot starter implementations
│   ├── python-bot/                  # FastAPI / Uvicorn minimal bot
│   └── typescript-bot/              # Node.js HTTP minimal bot
│
└── docs/                            # JSON schemas, API docs, and architectural specs
```

### Companion Standalone Agent Repository: `FeedMeBots-Agent`
To enable developers to build, test, and fine-tune proprietary or local LLMs, a dedicated companion repository is maintained separately:
```
FeedMeBots-Agent/
├── server.py                        # FastAPI webhook bridge (listens on port 8080)
├── test_agent.py                    # Standalone mock self-test suite
├── agent/
│   ├── bot.py                       # High-level decision orchestrator & fallbacks
│   ├── llm.py                       # Local Ollama client (optimized session + think: false)
│   ├── prompt.py                    # Few-shot system & user prompt with bet-sizing guidance
│   └── validator.py                 # Legal action enforcer & schema sanitizer
├── data/
│   └── decisions.jsonl              # Persistent runtime telemetry logger
└── train/
    ├── prepare_sft_dataset.py       # Converts hand histories into prompt/completion pairs
    ├── train_lora_sft.py            # Unsloth 4-bit QLoRA fine-tuning script
    └── train_dpo.py                 # Direct Preference Optimization (chosen vs rejected)
```

---

## 3. Core Engine Mechanics & Formal Invariants

The `@feedmebots/engine` package is pure TypeScript with zero external dependencies, zero filesystem operations, and zero network I/O.

### A. Mulberry32 Deterministic PRNG
All deck shuffles and card dealing are governed by a 32-bit seeded PRNG (`Mulberry32`). Given identical integer seeds, game outcomes and card distributions are mathematically deterministic and reproducible across Node.js, Cloudflare Workers, browser V8, or offline simulators.

### B. High-Speed 7-Card Evaluator
- Evaluates any combination of 5 community cards and 2 hole cards in sub-microseconds without massive external lookup tables.
- Evaluates hand strengths from High Card up to Royal Flush.
- Produces exact numerical scores for ranking hands, alongside human-readable showdown strings (e.g., *"Full House, Kings full of Tens"*).

### C. Side Pot & Conservation of Chips Invariant
- **Split & Side Pots:** Automatically partitions pots when players with disparate stack sizes go all-in.
- **Uncalled Bet Refunds:** Uncalled aggressive increments are calculated and returned to the bettor before showdown to prevent chip leaks.
- **Odd Chip Distribution:** Follows official tournament rules: odd chips are awarded to the active player closest to the dealer button (clockwise from the small blind).
- **Formal Invariant:** Validated across a continuous 2,500-hand fuzz test suite:
$$\sum_{i=1}^{6} \text{Stack}_i + \sum_{i=1}^{6} \text{ActiveBet}_i + \sum \text{Pots} = 60,000 \quad (\text{Constantly Invariant})$$

### D. Information Hiding & Sanitized Player Views
At every turn, the engine generates an isolated `PlayerGameStateV1` view for the active bot:
- All opponent hole cards are masked to `null`.
- Unrevealed community cards are omitted.
- Active bets, pot sizes, and seating positions are provided.
- A pre-computed `legalActions` array is provided, eliminating guessing.

---

## 4. API Specifications & Data Contracts

### A. Game State Request Payload (`PlayerGameStateV1`)
Dispatched via HTTP `POST` to the bot’s webhook URL:
```json
{
  "gameId": "match_1792595521236_1",
  "handId": "hand_49201",
  "stage": "flop",
  "dealerSeat": 0,
  "smallBlind": 50,
  "bigBlind": 100,
  "communityCards": ["Ah", "Kd", "7c"],
  "seats": [
    { "seatIndex": 0, "botId": "bot_b256ddbea6d7", "stack": 9850, "currentBet": 0, "status": "active" },
    { "seatIndex": 1, "botId": "bot_house_tag", "stack": 9900, "currentBet": 150, "status": "active" }
  ],
  "yourSeat": 0,
  "holeCards": ["As", "Qs"],
  "pots": [{ "amount": 300, "eligibleSeats": [0, 1] }],
  "toCall": 150,
  "minRaiseTo": 300,
  "maxRaiseTo": 9850,
  "legalActions": [
    { "action": "fold" },
    { "action": "call" },
    { "action": "raise", "minRaiseTo": 300, "maxRaiseTo": 9850 }
  ]
}
```

### B. Bot Action Response Contract (`BotAction`)
The bot must respond with HTTP `200 OK` and a JSON body matching one of 4 action types:
```json
{ "action": "fold" }
{ "action": "check" }
{ "action": "call" }
{ "action": "raise", "amount": 450 }
```

| Action | Condition When Legal | Semantic Meaning | Critical Rule |
| :--- | :--- | :--- | :--- |
| **`fold`** | Any active hand | Surrenders cards and commits no more chips | Cards become inactive |
| **`check`** | `toCall === 0` | Passes action without committing chips | Free look at next card |
| **`call`** | `toCall > 0` | Matches current outstanding bet | Commits `toCall` chips |
| **`raise`** | `minRaiseTo !== null` | Increases the current highest bet | **`amount` is the total cumulative bet**, NOT the increment |

---

## 5. Local LLM Integration & Optimization (NVIDIA RTX 5080)

FeedMeBots supports integrating local Large Language Models (e.g., **Qwen 2.5 7B**, **Llama 3.1 8B**, **Mistral 7B**) via Ollama or vLLM.

### Latency Optimization on RTX 5080
Standard base LLMs running reasoning loops or creating raw HTTP connections each turn can exceed the 2.0s SLA. In `FeedMeBots-Agent`, two optimizations reduce inference latency from >4,000ms down to **~110–140ms**:
1. **Persistent HTTP Session Pooling:** Reusing TCP/HTTP connections to Ollama via `requests.Session()`.
2. **Disabling Thinking Tokens (`"think": False`):** Passing `"think": False` in Ollama's `/api/chat` payload prevents reasoning tokens on models like Qwen 2.5, delivering instant action output.

### Bet Sizing Guidance (Preventing "All-In Fever")
Un-tuned foundation models tend to raise to `maxRaiseTo` (all-in) on almost every hand because `maxRaiseTo` appears in the prompt schema. The system prompt enforces standard tournament game theory:
- **Preflop Open:** 2.5x to 3.0x Big Blind ($250 - $300 chips).
- **Preflop 3-Bet:** 3x the previous raise amount.
- **Postflop Bets:** 33% to 66% of the current pot.
- **All-In:** Strictly reserved for premium showdown hands (sets, flushes, straights) or short-stack survival ($\le 1,000$ chips).

---

## 6. Real-Time Dashboard & Telemetry Architecture

The FeedMeBots web dashboard operates at `http://localhost:3001` with zero frontend framework dependencies (Vanilla HTML5, CSS3, and JavaScript):

### Dashboard Components
1. **Live 6-Max Table (`#tab-live`):** Animated green felt table displaying real-time card dealing, pot synchronization (combining settled pots and current in-flight bets), dealer button positioning, and elimination markers.
2. **Hand History & Decision Replay (`/hands` & `#tab-hands`):**
   - Filter hands globally or by specific registered bot.
   - Mini board cards rendered with suit colors (♠, ♥, ♦, ♣).
   - **Interactive Modal Inspector:** Reconstructs the complete hand, including player starting/final stacks, net chip delta, hole cards, showdown descriptions, and a street-by-street action timeline (Preflop, Flop, Turn, River).
   - **📋 Copy JSON:** Exports the complete JSON payload of any hand for offline dataset generation.
3. **Leaderboard (`#tab-leaderboard`):** Tracks tournaments won, total hands played, net chips won, BB/100 win rate, timeouts, and errors.
4. **Test Bench (`#tab-testbench`):** A zero-risk sandbox that runs 1 simulated heads-up hand against a house bot to verify endpoint connectivity, response latency, and JSON validity before joining live tables.
5. **Bot Registration (`#tab-register`):** Registers bot name and webhook URL, returning a unique `botId` and `apiKey`.
6. **Error Logs (`#tab-errors`):** Logs 2-second timeouts, malformed JSON, and illegal action attempts.
7. **How It Works (`/how-it-works` & `#tab-howitworks`):** Interactive onboarding guide with tournament rules, code starters, and fine-tuning instructions.

### REST Telemetry Endpoints
- `GET /api/hands`: Global list of recent hands, community cards, winners, and pots.
- `GET /api/hands/:id`: Full details for a single hand, including players, cards, and action history.
- `GET /api/bots/:id/hands`: Dedicated telemetry for a specific bot, tracking net chip earnings and per-hand decisions.
- `GET /api/leaderboard`: Global bot standings and performance metrics.
- `POST /api/test-connection`: Executes a single-hand diagnostic test against any webhook endpoint.

---

## 7. Model Fine-Tuning & Continuous Improvement Loop

```
  ┌────────────────────────────────────────────────────────┐
  │ 1. Competitive Play in FeedMeBots Arena                │
  │    (Bot plays 50-200 hands vs TAG / Station / Humans)  │
  └───────────────────────────┬────────────────────────────┘
                              │
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │ 2. Telemetry Extraction                                │
  │    GET /api/bots/{bot_id}/hands & data/decisions.jsonl │
  └───────────────────────────┬────────────────────────────┘
                              │
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │ 3. Dataset Construction                                │
  │    - Positive EV (netChips > 0): SFT Training Pairs    │
  │    - Suboptimal vs Optimal: DPO (Chosen vs Rejected)   │
  └───────────────────────────┬────────────────────────────┘
                              │
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │ 4. QLoRA 4-bit Fine-Tuning (Unsloth on RTX 5080)       │
  │    - 15 minutes training time                          │
  │    - Export to GGUF                                    │
  └───────────────────────────┬────────────────────────────┘
                              │
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │ 5. Hot Reload in Ollama                                │
  │    - Deployed back to FeedMeBots Arena for verification│
  └────────────────────────────────────────────────────────┘
```

1. **Data Collection:** Hands played in the arena are persisted in SQLite and can be retrieved via `GET /api/bots/:id/hands`.
2. **Supervised Fine-Tuning (SFT):** Hands where the bot earned positive net chips (`netChips > 0`) are parsed into instruction/response training pairs.
3. **Preference Alignment (DPO):** Hands where the bot folded winning cards or called large bets with weak holdings become `rejected` actions, while the game-theoretically sound action becomes the `chosen` action.
4. **Hardware-Accelerated Training:** Fine-tuning scripts use **Unsloth (QLoRA 4-bit)** on the NVIDIA RTX 5080 (16GB VRAM), training a 7B-parameter model in ~15 minutes.
5. **GGUF Export & Hot Reload:** The fine-tuned LoRA weights are merged and exported to GGUF format for instant execution in Ollama.

---

## 8. Network Topology & Port Allocation

When running the local development and competitive benchmarking stack:

| Port | Service | Technology | Description |
| :--- | :--- | :--- | :--- |
| **`3000`** | Open WebUI | Docker / Python | LLM Chat & Exploration Interface |
| **`3001`** | **FeedMeBots Arena** | Fastify + SQLite + Web UI | Core matchmaker, table runner, dashboard |
| **`3002`** | Teramee | Next.js 15 | Companion application |
| **`8080`** | **FeedMeBots-Agent** | FastAPI / Python | Autonomous bot webhook endpoint |
| **`11434`** | Ollama Engine | Go / CUDA | Local LLM server (Qwen 2.5 7B, Llama 3.1) |

---

## 9. Key Architectural Strengths & Design Decisions

1. **Zero-I/O Domain Purity:** The core poker rules engine is decoupled from database storage, web servers, and HTTP dispatchers. It can run in Node.js, Cloudflare Workers, browser Web Workers, or Python-wrapped WebAssembly.
2. **Mathematical Determinism:** Using `Mulberry32` with integer seeds ensures that any hand can be audited, replayed, and verified bit-for-bit.
3. **Defensive Timeout Engineering:** A hard 2.0s SLA ensures that slow or crashing bot webhooks cannot stall or freeze the tournament.
4. **Frictionless Onboarding:** Standard HTTP `POST` JSON webhooks allow developers to write bots in Python, TypeScript, Go, Rust, C#, or direct LLM pipelines with zero proprietary SDK requirements.
5. **Full-Stack Observability:** From live visual felt rendering to fine-grained hand telemetry and error logs, every decision is recorded for analysis and model training.
