#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import {
  Action,
  callingStationBot,
  createRandomBot,
  createTAGBot,
  GameConfig,
  PlayerGameStateV1,
  PokerEngine,
  PRNG
} from '@feedmebots/engine';

interface BotConfig {
  id: string;
  name: string;
  type: 'local' | 'webhook';
  localFn?: (state: PlayerGameStateV1) => Action;
  webhookUrl?: string;
}

interface BotStats {
  id: string;
  name: string;
  handsPlayed: number;
  chipsWon: number;
  timeouts: number;
  errors: number;
}

async function fetchWebhookAction(url: string, state: PlayerGameStateV1, timeoutMs = 2000): Promise<Action> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as Action;
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const program = new Command();

  program
    .name('feedmebots-sim')
    .description('FeedMeBots offline / hybrid poker simulator CLI')
    .option('-n, --hands <number>', 'Number of hands to simulate', '100')
    .option('-b, --bots <list>', 'Comma-separated bot list: tag, random, station, or http://url', 'tag,random,station,tag')
    .option('--sb <number>', 'Small blind amount', '50')
    .option('--bb <number>', 'Big blind amount', '100')
    .option('--starting-stack <number>', 'Starting stack per hand', '10000')
    .option('--export <path>', 'Export hand histories to JSON file')
    .option('--seed <number>', 'Master random seed for reproducibility')
    .parse(process.argv);

  const options = program.opts();
  const handsToRun = parseInt(options.hands, 10);
  const sb = parseInt(options.sb, 10);
  const bb = parseInt(options.bb, 10);
  const startingStack = parseInt(options.startingStack, 10);
  const masterSeed = options.seed ? parseInt(options.seed, 10) : Date.now();
  const botStrings: string[] = options.bots.split(',').map((s: string) => s.trim());

  if (botStrings.length < 2 || botStrings.length > 6) {
    console.error('Error: Must specify between 2 and 6 bots.');
    process.exit(1);
  }

  const bots: BotConfig[] = botStrings.map((spec, idx) => {
    const id = `bot_${idx}`;
    if (spec.startsWith('http://') || spec.startsWith('https://')) {
      return { id, name: `Webhook (${spec})`, type: 'webhook', webhookUrl: spec };
    }
    const lower = spec.toLowerCase();
    if (lower === 'tag') {
      return { id, name: `TAGBot_${idx}`, type: 'local', localFn: createTAGBot(masterSeed + idx) };
    }
    if (lower === 'station') {
      return { id, name: `StationBot_${idx}`, type: 'local', localFn: callingStationBot };
    }
    return { id, name: `RandomBot_${idx}`, type: 'local', localFn: createRandomBot(masterSeed + idx) };
  });

  const statsMap = new Map<string, BotStats>();
  for (const b of bots) {
    statsMap.set(b.id, {
      id: b.id,
      name: b.name,
      handsPlayed: 0,
      chipsWon: 0,
      timeouts: 0,
      errors: 0
    });
  }

  console.log(`\n🃏 Starting FeedMeBots Simulation:`);
  console.log(`   Hands: ${handsToRun}`);
  console.log(`   Blinds: ${sb} / ${bb}`);
  console.log(`   Starting Stack: ${startingStack}`);
  console.log(`   Bots: ${bots.map(b => b.name).join(', ')}`);
  console.log(`   Master Seed: ${masterSeed}\n`);

  const simPRNG = new PRNG(masterSeed);
  const handHistories: any[] = [];
  const startTime = Date.now();

  for (let h = 0; h < handsToRun; h++) {
    const handId = `sim_hand_${h + 1}`;
    const dealerSeat = h % bots.length;
    const handSeed = simPRNG.nextInt();

    const initialSeats = bots.map((b, idx) => ({
      seatIndex: idx,
      botId: b.id,
      botName: b.name,
      stack: startingStack
    }));

    const config: GameConfig = {
      gameId: 'sim_session',
      handId,
      smallBlind: sb,
      bigBlind: bb,
      dealerSeat,
      seats: initialSeats,
      seed: handSeed
    };

    let state = PokerEngine.createGame(config);

    while (state.stage !== 'ended' && state.currentTurnSeat !== null) {
      const currentSeat = state.currentTurnSeat;
      const botConfig = bots[currentSeat];
      const botStats = statsMap.get(botConfig.id)!;
      const playerView = PokerEngine.getPlayerView(state, currentSeat);

      let action: Action;
      try {
        if (botConfig.type === 'local' && botConfig.localFn) {
          action = botConfig.localFn(playerView);
        } else if (botConfig.type === 'webhook' && botConfig.webhookUrl) {
          action = await fetchWebhookAction(botConfig.webhookUrl, playerView);
        } else {
          action = { action: 'check' };
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          botStats.timeouts++;
        } else {
          botStats.errors++;
        }
        // Auto check/fold
        const canCheck = playerView.legalActions.some(a => a.action === 'check');
        action = canCheck ? { action: 'check' } : { action: 'fold' };
      }

      const res = PokerEngine.step(state, action);
      if (res.error) {
        botStats.errors++;
        // Auto check/fold fallback
        const canCheck = playerView.legalActions.some(a => a.action === 'check');
        const fallbackAction: Action = canCheck ? { action: 'check' } : { action: 'fold' };
        state = PokerEngine.step(state, fallbackAction).state;
      } else {
        state = res.state;
      }
    }

    // Record stats
    for (const seat of state.seats) {
      const bStats = statsMap.get(seat.botId)!;
      bStats.handsPlayed++;
      const net = seat.stack - startingStack;
      bStats.chipsWon += net;
    }

    if (options.export) {
      handHistories.push({
        handId,
        seed: handSeed,
        dealerSeat,
        communityCards: state.communityCards,
        winners: state.winners,
        seats: state.seats.map(s => ({
          seatIndex: s.seatIndex,
          botId: s.botId,
          botName: s.botName,
          finalStack: s.stack,
          holeCards: s.holeCards,
          rank: s.showdownRank?.description
        })),
        actionHistory: state.actionHistory
      });
    }

    if ((h + 1) % Math.max(1, Math.floor(handsToRun / 10)) === 0 || h === handsToRun - 1) {
      process.stdout.write(`\rProgress: ${h + 1}/${handsToRun} hands completed...`);
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n\n✅ Simulation finished in ${durationSec}s!`);

  // Print results table
  console.log('\n📊 Leaderboard / Final Results:');
  const results = Array.from(statsMap.values()).map(s => {
    const bb100 = s.handsPlayed > 0 ? ((s.chipsWon / bb / s.handsPlayed) * 100).toFixed(2) : '0.00';
    return {
      Bot: s.name,
      'Hands Played': s.handsPlayed,
      'Net Chips': s.chipsWon,
      'BB / 100': bb100,
      Timeouts: s.timeouts,
      Errors: s.errors
    };
  });
  console.table(results);

  if (options.export) {
    const exportPath = path.resolve(process.cwd(), options.export);
    fs.writeFileSync(exportPath, JSON.stringify(handHistories, null, 2), 'utf-8');
    console.log(`💾 Hand histories exported to: ${exportPath}`);
  }
}

main().catch(err => {
  console.error('Simulation error:', err);
  process.exit(1);
});
