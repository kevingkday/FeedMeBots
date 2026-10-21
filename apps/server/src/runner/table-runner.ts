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
} from '@feedmebots/engine';
import { db } from '../db/db.js';
import { dispatchWebhookAction, logBotError } from './dispatcher.js';
import { botConnectionManager } from './bot-connections.js';

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

export class TableRunner {
  private isRunning = false;
  private currentHand: InternalGameState | null = null;
  private currentSeats: TableBot[] = [];
  private currentMatchInfo: MatchInfo | null = null;
  private dealerSeat = 0;
  private handCounter = 0;
  private matchCounter = 0;
  private tableId = 'tbl_main_1';
  private prng = new PRNG(Date.now());
  private listeners: Array<(state: InternalGameState) => void> = [];

  constructor() {
    this.ensureHouseBotsExist();
  }

  private ensureHouseBotsExist() {
    const houseBots = [
      { id: 'house_tag_1', name: 'TightAggressiveBot', is_house: 1 },
      { id: 'house_station_1', name: 'CallingStationBot', is_house: 1 },
      { id: 'house_random_1', name: 'RandomBot', is_house: 1 }
    ];

    for (const b of houseBots) {
      const exists = db.prepare('SELECT id FROM bots WHERE id = ?').get(b.id);
      if (!exists) {
        db.prepare(`
          INSERT INTO bots (id, name, api_key, webhook_url, is_active, is_house, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, 1, ?, ?)
        `).run(b.id, b.name, `key_${b.id}`, 'local', Date.now(), Date.now());
      }
    }
  }

  public subscribe(cb: (state: InternalGameState) => void) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  private emitState(state: InternalGameState) {
    this.currentHand = state;
    for (const l of this.listeners) {
      try {
        l(state);
      } catch (e) {
        console.error('Error in state listener:', e);
      }
    }
  }

  public getCurrentState(): { state: InternalGameState | null; match: MatchInfo | null } {
    return {
      state: this.currentHand,
      match: this.currentMatchInfo
    };
  }

  public isTableRunning(): boolean {
    return this.isRunning;
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('🚀 FeedMeBots Table Runner started (Sit & Go Tournament Mode).');
    this.runLoop().catch(err => {
      console.error('Fatal table runner loop error:', err);
      this.isRunning = false;
    });
  }

  public stop() {
    this.isRunning = false;
    console.log('🛑 FeedMeBots Table Runner stopped.');
  }

  private async runLoop() {
    while (this.isRunning) {
      try {
        await this.playSitAndGoMatch();
      } catch (err) {
        console.error('Error during table match execution:', err);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  private assembleSeats(): TableBot[] {
    // 1. Fetch active registered user bots (prioritizing actively connected CLI Bridge bots!)
    const connectedIds = botConnectionManager.getConnectedBotIds();
    const seats: TableBot[] = [];

    // Prioritize bots that currently have an active CLI bridge connection
    if (connectedIds.length > 0) {
      const placeholders = connectedIds.map(() => '?').join(',');
      const connectedBots = db.prepare(`
        SELECT id, name, webhook_url FROM bots
        WHERE id IN (${placeholders}) AND is_active = 1
        LIMIT 4
      `).all(...connectedIds) as Array<{ id: string; name: string; webhook_url: string }>;

      for (const cb of connectedBots) {
        seats.push({
          id: cb.id,
          name: cb.name,
          isHouse: false,
          webhookUrl: cb.webhook_url,
          stack: 10000
        });
      }
    }

    // Fill remaining user slots (up to 4 user bots total) with random registered bots
    if (seats.length < 4) {
      const existingIds = seats.map(s => s.id);
      const notInClause = existingIds.length > 0 
        ? `AND id NOT IN (${existingIds.map(() => '?').join(',')})`
        : '';
      const limit = 4 - seats.length;

      const userBots = db.prepare(`
        SELECT id, name, webhook_url FROM bots 
        WHERE is_active = 1 AND is_house = 0 ${notInClause}
        ORDER BY RANDOM()
        LIMIT ?
      `).all(...existingIds, limit) as Array<{ id: string; name: string; webhook_url: string }>;

      for (const ub of userBots) {
        seats.push({
          id: ub.id,
          name: ub.name,
          isHouse: false,
          webhookUrl: ub.webhook_url,
          stack: 10000
        });
      }
    }

    // 2. Fill remaining seats with house bots to reach 6 seats
    const houseConfigs: Array<{ id: string; name: string; fn: (state: PlayerGameStateV1) => Action }> = [
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
    this.currentSeats = this.assembleSeats(); // 6 players with 10,000 chips each
    this.dealerSeat = this.prng.nextRange(0, 5);
    let handNumberInMatch = 0;

    console.log(`\n🏆 Starting Sit & Go Match #${this.matchCounter} (${matchId}) with 6 players!`);

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
        // We have a champion!
        const champion = activeBots[0] || this.currentSeats[0];
        this.currentMatchInfo.winnerName = champion.name;
        console.log(`\n👑 Match #${this.matchCounter} Champion: ${champion.name} won all 60,000 chips!`);

        // Record match in DB
        try {
          db.prepare(`
            INSERT INTO matches (id, winner_bot_id, total_hands, created_at)
            VALUES (?, ?, ?, ?)
          `).run(matchId, champion.id, handNumberInMatch, Date.now());
        } catch (e) {
          console.error('Failed to record match in DB:', e);
        }

        if (this.currentHand) {
          this.currentHand.stage = 'ended';
          this.emitState(this.currentHand);
        }

        // 4.5 seconds celebration for the champion before starting the next match
        await new Promise(r => setTimeout(r, 4500));
        break;
      }

      handNumberInMatch++;
      this.currentMatchInfo.handNumber = handNumberInMatch;
      await this.playOneHand(matchId, handNumberInMatch);
      // Brief pause between hands in the tournament
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  private async playOneHand(matchId: string, handNumberInMatch: number) {
    this.handCounter++;
    const handId = `hnd_${Date.now()}_${this.handCounter}`;

    // Rotate dealer button among surviving players with stack > 0
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
    this.emitState(state);

    let stepCount = 0;
    const MAX_STEPS = 150;
    let previousStage = state.stage;

    while (state.stage !== 'ended' && state.currentTurnSeat !== null && this.isRunning) {
      stepCount++;
      if (stepCount > MAX_STEPS) {
        console.warn(`Hand ${handId} exceeded max steps, breaking.`);
        break;
      }

      const turnSeat = state.currentTurnSeat;
      const bot = this.currentSeats[turnSeat];
      const playerView = PokerEngine.getPlayerView(state, turnSeat);

      let action: Action;

      if (bot.isHouse && bot.localFn) {
        // Human-friendly visual delay so spectator sees whose turn it is
        await new Promise(r => setTimeout(r, 450));
        action = bot.localFn(playerView);
      } else if (botConnectionManager.has(bot.id)) {
        // Dispatched via active WebSocket CLI Bridge (zero public URL needed!)
        const dispatch = await botConnectionManager.dispatchAction(bot.id, playerView, 2000);
        if (dispatch.success && dispatch.action) {
          action = dispatch.action;
        } else {
          const canCheck = playerView.legalActions.some(a => a.action === 'check');
          action = canCheck ? { action: 'check' } : { action: 'fold' };
        }
      } else if (bot.webhookUrl && !bot.webhookUrl.startsWith('cli://')) {
        // Dispatched webhook with 2s timeout
        const dispatch = await dispatchWebhookAction(bot.id, bot.webhookUrl, playerView, 2000);
        if (dispatch.success && dispatch.action) {
          action = dispatch.action;
        } else {
          // Fallback to check/fold on timeout or bad response
          const canCheck = playerView.legalActions.some(a => a.action === 'check');
          action = canCheck ? { action: 'check' } : { action: 'fold' };
        }
      } else {
        const canCheck = playerView.legalActions.some(a => a.action === 'check');
        action = canCheck ? { action: 'check' } : { action: 'fold' };
      }

      // Step engine
      const stepRes = PokerEngine.step(state, action);
      if (stepRes.error) {
        // Illegal action: log and fallback to check/fold
        logBotError(
          bot.id,
          state.handId,
          state.stage,
          'illegal_action',
          JSON.stringify(playerView),
          JSON.stringify(action),
          `Illegal action: ${stepRes.error}`
        );
        const canCheck = playerView.legalActions.some(a => a.action === 'check');
        const fallback: Action = canCheck ? { action: 'check' } : { action: 'fold' };
        state = PokerEngine.step(state, fallback).state;
      } else {
        state = stepRes.state;
      }

      this.emitState(state);

      // If stage changed (e.g. preflop -> flop, flop -> turn, turn -> river), pause so user can see board cards dealt!
      if (state.stage !== previousStage && state.stage !== 'ended') {
        previousStage = state.stage;
        await new Promise(r => setTimeout(r, 650));
      }
    }

    // Persist chip stacks across tournament hands!
    for (const seat of state.seats) {
      this.currentSeats[seat.seatIndex].stack = seat.stack;
    }

    // Save completed hand to database
    this.saveHandToDb(state, startingStacks, handSeed);

    // End-of-hand celebration pause so spectator can review winner and community cards!
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

  private saveHandToDb(state: InternalGameState, startingStacks: number[], seed: number) {
    try {
      const totalPot = state.pots.reduce((sum, p) => sum + p.amount, 0);

      const insertHand = db.prepare(`
        INSERT INTO hands (id, game_id, seed, small_blind, big_blind, dealer_seat, community_cards, action_history, winners, total_pot, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertPlayer = db.prepare(`
        INSERT INTO hand_players (hand_id, seat_index, bot_id, starting_stack, final_stack, net_chips, hole_cards, rank_description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const transaction = db.transaction(() => {
        insertHand.run(
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
        );

        for (const seat of state.seats) {
          const starting = startingStacks[seat.seatIndex] ?? 10000;
          const net = seat.stack - starting;
          insertPlayer.run(
            state.handId,
            seat.seatIndex,
            seat.botId,
            starting,
            seat.stack,
            net,
            seat.holeCards ? JSON.stringify(seat.holeCards) : null,
            seat.showdownRank ? seat.showdownRank.description : null
          );
        }
      });

      transaction();
    } catch (e) {
      console.error('Failed to save hand to database:', e);
    }
  }

  /**
   * "Test Connection" runner: plays 1 full heads-up hand vs a house bot.
   * Returns complete exchange history (payloads sent, responses, latency, result).
   */
  public async testConnection(webhookUrl: string, botName = 'TesterBot'): Promise<{
    success: boolean;
    handId: string;
    exchanges: Array<{
      stage: string;
      requestSent: PlayerGameStateV1;
      responseReceived: any;
      latencyMs: number;
      error?: string;
    }>;
    handSummary: {
      communityCards: string[];
      winners: any[];
      botWonChips: number;
    };
  }> {
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
        // User webhook bot (allow 4000ms for test bench to accommodate initial LLM cold starts)
        const dispatch = await dispatchWebhookAction('tester_bot', webhookUrl, playerView, 4000);
        exchanges.push({
          stage: state.stage,
          requestSent: playerView,
          responseReceived: dispatch.action || dispatch.rawResponse,
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
        // House bot
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
