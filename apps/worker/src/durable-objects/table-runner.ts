import {
  Action,
  callingStationBot,
  createRandomBot,
  createTAGBot,
  GameConfig,
  InternalGameState,
  PlayerGameStateV1,
  PokerEngine,
  PRNG
} from '../../../../packages/engine/src/index.ts';

export interface Env {
  DB: D1Database;
  TABLE_RUNNER: DurableObjectNamespace;
}

export interface TableBot {
  id: string;
  name: string;
  isHouse: boolean;
  webhookUrl?: string;
  localFn?: (state: PlayerGameStateV1) => Action;
  stack: number;
}

export interface MatchInfo {
  matchId: string;
  matchNumber: number;
  handNumber: number;
  playersRemaining: number;
  totalPlayers: number;
  winnerName?: string;
}

export class TableDurableObject implements DurableObject {
  private isRunning = false;
  private currentHand: InternalGameState | null = null;
  private currentSeats: TableBot[] = [];
  private currentMatchInfo: MatchInfo | null = null;
  private dealerSeat = 0;
  private handCounter = 0;
  private matchCounter = 0;
  private prng = new PRNG(Date.now());
  private connectedSockets: Set<WebSocket> = new Set();

  constructor(private state: DurableObjectState, private env: Env) {}

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket endpoint for real-time table spectator streaming
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      server.accept();
      this.connectedSockets.add(server);

      server.addEventListener('close', () => {
        this.connectedSockets.delete(server);
      });

      // Send initial state immediately
      server.send(JSON.stringify({
        type: 'INIT',
        state: this.currentHand,
        match: this.currentMatchInfo,
        isRunning: this.isRunning
      }));

      // Auto start table if not already running
      if (!this.isRunning) {
        this.start();
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    // REST state endpoint
    if (url.pathname === '/state') {
      if (!this.isRunning) {
        this.start();
      }
      return Response.json({
        isRunning: this.isRunning,
        state: this.currentHand,
        match: this.currentMatchInfo
      });
    }

    // Test connection endpoint
    if (url.pathname === '/test-connection' && request.method === 'POST') {
      const body = await request.json() as { webhookUrl: string; botName?: string };
      const res = await this.testConnection(body.webhookUrl, body.botName);
      return Response.json(res);
    }

    if (url.pathname === '/start') {
      this.start();
      return Response.json({ isRunning: true });
    }

    if (url.pathname === '/stop') {
      this.stop();
      return Response.json({ isRunning: false });
    }

    return new Response('Not Found', { status: 404 });
  }

  private broadcast(data: any) {
    const msg = JSON.stringify(data);
    for (const ws of this.connectedSockets) {
      try {
        ws.send(msg);
      } catch {
        this.connectedSockets.delete(ws);
      }
    }
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.runLoop().catch(err => {
      console.error('Fatal table runner loop error in DO:', err);
      this.isRunning = false;
    });
  }

  public stop() {
    this.isRunning = false;
  }

  private async runLoop() {
    while (this.isRunning) {
      try {
        await this.playSitAndGoMatch();
      } catch (err) {
        console.error('Error during DO match execution:', err);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  private async assembleSeats(): Promise<TableBot[]> {
    // 1. Fetch active registered user bots from D1
    let userBots: Array<{ id: string; name: string; webhook_url: string }> = [];
    try {
      const res = await this.env.DB.prepare(`
        SELECT id, name, webhook_url FROM bots 
        WHERE is_active = 1 AND is_house = 0
        ORDER BY RANDOM()
        LIMIT 4
      `).all();
      userBots = (res.results || []) as any;
    } catch (e) {
      console.error('Failed to query user bots from D1:', e);
    }

    const seats: TableBot[] = [];
    for (const ub of userBots) {
      seats.push({
        id: ub.id,
        name: ub.name,
        isHouse: false,
        webhookUrl: ub.webhook_url,
        stack: 10000
      });
    }

    // 2. Fill remaining seats with house bots
    const houseConfigs = [
      { id: 'house_tag_1', name: 'TightAggressiveBot', fn: createTAGBot(this.prng.nextInt()) },
      { id: 'house_station_1', name: 'CallingStationBot', fn: callingStationBot },
      { id: 'house_random_1', name: 'RandomBot', fn: createRandomBot(this.prng.nextInt()) },
      { id: 'house_tag_2', name: 'TAGBot_2', fn: createTAGBot(this.prng.nextInt()) },
      { id: 'house_station_2', name: 'CallingStation_2', fn: callingStationBot },
      { id: 'house_random_2', name: 'RandomBot_2', fn: createRandomBot(this.prng.nextInt()) }
    ];

    let hIdx = 0;
    while (seats.length < 6) {
      const hc = houseConfigs[hIdx % houseConfigs.length];
      seats.push({
        id: hc.id,
        name: hc.name,
        isHouse: true,
        localFn: hc.fn,
        stack: 10000
      });
      hIdx++;
    }

    return seats;
  }

  private async playSitAndGoMatch() {
    this.matchCounter++;
    const matchId = `match_${Date.now()}_${this.matchCounter}`;
    this.currentSeats = await this.assembleSeats();
    this.dealerSeat = this.prng.nextRange(0, 5);
    let handNumberInMatch = 0;

    while (this.isRunning) {
      const activeBots = this.currentSeats.filter(s => s.stack > 0);
      this.currentMatchInfo = {
        matchId,
        matchNumber: this.matchCounter,
        handNumber: handNumberInMatch,
        playersRemaining: activeBots.length,
        totalPlayers: this.currentSeats.length
      };

      if (activeBots.length <= 1) {
        // Champion crowned!
        const champion = activeBots[0] || this.currentSeats[0];
        this.currentMatchInfo.winnerName = champion.name;

        // Record in D1
        try {
          await this.env.DB.prepare(`
            INSERT INTO matches (id, winner_bot_id, total_hands, created_at)
            VALUES (?, ?, ?, ?)
          `).bind(matchId, champion.id, handNumberInMatch, Date.now()).run();
        } catch (e) {
          console.error('Failed to log match in D1:', e);
        }

        if (this.currentHand) {
          this.currentHand.stage = 'ended';
          this.broadcast({ type: 'UPDATE', state: this.currentHand, match: this.currentMatchInfo });
        }

        await new Promise(r => setTimeout(r, 4500));
        break;
      }

      handNumberInMatch++;
      this.currentMatchInfo.handNumber = handNumberInMatch;
      await this.playOneHand(matchId);
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  private async playOneHand(matchId: string) {
    this.handCounter++;
    const handId = `hnd_${Date.now()}_${this.handCounter}`;

    this.dealerSeat = this.findNextActiveSeat(this.dealerSeat);
    const startingStacks = this.currentSeats.map(s => s.stack);
    const handSeed = this.prng.nextInt();

    const config: GameConfig = {
      gameId: matchId,
      handId,
      smallBlind: 50,
      bigBlind: 100,
      dealerSeat: this.dealerSeat,
      seats: this.currentSeats.map((b, idx) => ({
        seatIndex: idx,
        botId: b.id,
        botName: b.name,
        stack: b.stack
      })),
      seed: handSeed
    };

    let state = PokerEngine.createGame(config);
    this.currentHand = state;
    this.broadcast({ type: 'UPDATE', state, match: this.currentMatchInfo });

    let stepCount = 0;
    const MAX_STEPS = 150;
    let previousStage = state.stage;

    while (state.stage !== 'ended' && state.currentTurnSeat !== null && this.isRunning) {
      stepCount++;
      if (stepCount > MAX_STEPS) break;

      const turnSeat = state.currentTurnSeat;
      const bot = this.currentSeats[turnSeat];
      const playerView = PokerEngine.getPlayerView(state, turnSeat);

      let action: Action;

      if (bot.isHouse && bot.localFn) {
        await new Promise(r => setTimeout(r, 450));
        action = bot.localFn(playerView);
      } else if (bot.webhookUrl) {
        const dispatch = await this.dispatchWebhook(bot.id, bot.webhookUrl, playerView, 2000);
        if (dispatch.success && dispatch.action) {
          action = dispatch.action;
        } else {
          const canCheck = playerView.legalActions.some(a => a.action === 'check');
          action = canCheck ? { action: 'check' } : { action: 'fold' };
        }
      } else {
        const canCheck = playerView.legalActions.some(a => a.action === 'check');
        action = canCheck ? { action: 'check' } : { action: 'fold' };
      }

      const stepRes = PokerEngine.step(state, action);
      if (stepRes.error) {
        const canCheck = playerView.legalActions.some(a => a.action === 'check');
        const fallback: Action = canCheck ? { action: 'check' } : { action: 'fold' };
        state = PokerEngine.step(state, fallback).state;
      } else {
        state = stepRes.state;
      }

      this.currentHand = state;
      this.broadcast({ type: 'UPDATE', state, match: this.currentMatchInfo });

      if (state.stage !== previousStage && state.stage !== 'ended') {
        previousStage = state.stage;
        await new Promise(r => setTimeout(r, 650));
      }
    }

    // Persist stacks
    for (const seat of state.seats) {
      this.currentSeats[seat.seatIndex].stack = seat.stack;
    }

    // Log to D1
    await this.saveHandToD1(state, startingStacks, handSeed);

    await new Promise(r => setTimeout(r, 2200));
  }

  private findNextActiveSeat(fromSeatIndex: number): number {
    for (let offset = 1; offset <= 6; offset++) {
      const checkSeat = (fromSeatIndex + offset) % 6;
      if (this.currentSeats[checkSeat] && this.currentSeats[checkSeat].stack > 0) {
        return checkSeat;
      }
    }
    return fromSeatIndex;
  }

  private async dispatchWebhook(
    botId: string,
    webhookUrl: string,
    state: PlayerGameStateV1,
    timeoutMs = 2000
  ): Promise<{ success: boolean; action?: Action; errorMessage?: string; latencyMs: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    const payload = JSON.stringify(state);

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'FeedMeBots-Cloudflare/1.0',
          'X-FeedMeBots-Version': 'v1'
        },
        body: payload,
        signal: controller.signal
      });

      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return { success: false, errorMessage: `HTTP ${res.status}`, latencyMs };
      }

      const data = await res.json() as any;
      if (!data || typeof data.action !== 'string') {
        return { success: false, errorMessage: 'Malformed response', latencyMs };
      }

      return {
        success: true,
        action: { action: data.action, amount: data.amount },
        latencyMs
      };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      return { success: false, errorMessage: err.message || 'Timeout', latencyMs };
    } finally {
      clearTimeout(timer);
    }
  }

  private async saveHandToD1(state: InternalGameState, startingStacks: number[], seed: number) {
    try {
      const totalPot = state.pots.reduce((sum, p) => sum + p.amount, 0);

      // Insert hand
      await this.env.DB.prepare(`
        INSERT INTO hands (id, game_id, seed, small_blind, big_blind, dealer_seat, community_cards, action_history, winners, total_pot, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        state.handId,
        state.gameId,
        String(seed),
        state.smallBlind,
        state.bigBlind,
        state.dealerSeat,
        JSON.stringify(state.communityCards),
        JSON.stringify(state.actionHistory),
        JSON.stringify(state.winners || []),
        totalPot,
        Date.now()
      ).run();

      // Insert hand players
      const stmts = state.seats.map(seat => {
        const starting = startingStacks[seat.seatIndex] ?? 10000;
        const net = seat.stack - starting;
        return this.env.DB.prepare(`
          INSERT INTO hand_players (hand_id, seat_index, bot_id, starting_stack, final_stack, net_chips, hole_cards, rank_description)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          state.handId,
          seat.seatIndex,
          seat.botId,
          starting,
          seat.stack,
          net,
          seat.holeCards ? JSON.stringify(seat.holeCards) : null,
          seat.showdownRank ? seat.showdownRank.description : null
        );
      });

      await this.env.DB.batch(stmts);
    } catch (e) {
      console.error('Failed to save hand to D1:', e);
    }
  }

  public async testConnection(webhookUrl: string, botName = 'TesterBot') {
    const handId = `test_${Date.now()}`;
    const houseBot = createTAGBot(42);

    const config: GameConfig = {
      gameId: 'test_session',
      handId,
      smallBlind: 50,
      bigBlind: 100,
      dealerSeat: 0,
      seats: [
        { seatIndex: 0, botId: 'tester_bot', botName, stack: 5000 },
        { seatIndex: 1, botId: 'house_tag', botName: 'TightAggressiveBot', stack: 5000 }
      ],
      seed: 555666
    };

    let state = PokerEngine.createGame(config);
    const exchanges: any[] = [];
    let botTimedOutOrErrored = false;

    let stepCount = 0;
    while (state.stage !== 'ended' && state.currentTurnSeat !== null && stepCount < 60) {
      stepCount++;
      const turnSeat = state.currentTurnSeat;
      const playerView = PokerEngine.getPlayerView(state, turnSeat);

      let action: Action;
      if (turnSeat === 0) {
        const dispatch = await this.dispatchWebhook('tester_bot', webhookUrl, playerView, 2000);
        exchanges.push({
          stage: state.stage,
          requestSent: playerView,
          responseReceived: dispatch.action || dispatch.errorMessage,
          latencyMs: dispatch.latencyMs,
          error: dispatch.errorMessage
        });

        if (!dispatch.success) {
          botTimedOutOrErrored = true;
          const canCheck = playerView.legalActions.some(a => a.action === 'check');
          action = canCheck ? { action: 'check' } : { action: 'fold' };
        } else {
          action = dispatch.action!;
        }
      } else {
        action = houseBot(playerView);
      }

      const res = PokerEngine.step(state, action);
      if (res.error) {
        if (turnSeat === 0) {
          botTimedOutOrErrored = true;
          exchanges[exchanges.length - 1].error = `Illegal Action: ${res.error}`;
        }
        const canCheck = playerView.legalActions.some(a => a.action === 'check');
        const fallback: Action = canCheck ? { action: 'check' } : { action: 'fold' };
        state = PokerEngine.step(state, fallback).state;
      } else {
        state = res.state;
      }
    }

    const heroSeat = state.seats.find(s => s.seatIndex === 0)!;
    const netChips = heroSeat.stack - 5000;

    return {
      success: !botTimedOutOrErrored,
      handId,
      exchanges,
      handSummary: {
        communityCards: state.communityCards,
        winners: state.winners || [],
        botWonChips: netChips
      }
    };
  }
}
