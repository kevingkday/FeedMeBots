import { describe, expect, it } from 'vitest';
import { PokerEngine } from '../src/engine.js';
import { GameConfig } from '../src/types.js';

describe('Poker Engine Rules & State Machine', () => {
  const baseConfig: GameConfig = {
    gameId: 'game_test_1',
    handId: 'hand_test_1',
    smallBlind: 50,
    bigBlind: 100,
    dealerSeat: 0,
    seats: [
      { seatIndex: 0, botId: 'b0', botName: 'Dealer', stack: 2000 },
      { seatIndex: 1, botId: 'b1', botName: 'SB', stack: 2000 },
      { seatIndex: 2, botId: 'b2', botName: 'BB', stack: 2000 },
      { seatIndex: 3, botId: 'b3', botName: 'UTG', stack: 2000 }
    ],
    seed: 123456
  };

  it('posts blinds and initializes first preflop turn to UTG in 4-player game', () => {
    const state = PokerEngine.createGame(baseConfig);
    expect(state.stage).toBe('preflop');
    expect(state.smallBlindSeat).toBe(1);
    expect(state.bigBlindSeat).toBe(2);

    const sb = state.seats.find(s => s.seatIndex === 1)!;
    const bb = state.seats.find(s => s.seatIndex === 2)!;
    expect(sb.currentBet).toBe(50);
    expect(sb.stack).toBe(1950);
    expect(bb.currentBet).toBe(100);
    expect(bb.stack).toBe(1900);

    // UTG is seat 3
    expect(state.currentTurnSeat).toBe(3);

    // Legal actions for UTG
    const view = PokerEngine.getPlayerView(state, 3);
    expect(view.toCall).toBe(100);
    expect(view.minRaiseTo).toBe(200); // 100 + 100
    expect(view.maxRaiseTo).toBe(2000);
    expect(view.legalActions.map(a => a.action)).toEqual(['fold', 'call', 'raise']);
  });

  it('masks opponents cards in getPlayerView', () => {
    const state = PokerEngine.createGame(baseConfig);
    const heroView = PokerEngine.getPlayerView(state, 3);

    // Hero hole cards should be visible
    expect(heroView.holeCards.length).toBe(2);

    // Opponent hole cards should be undefined
    const opp0 = heroView.seats.find(s => s.seatIndex === 0)!;
    const opp1 = heroView.seats.find(s => s.seatIndex === 1)!;
    expect(opp0.holeCards).toBeUndefined();
    expect(opp1.holeCards).toBeUndefined();
  });

  it('correctly handles all-in under-raise and does not reopen betting to original bettor', () => {
    // 3 players:
    // Seat 0: 5000 (Dealer)
    // Seat 1: 5000 (SB)
    // Seat 2: 150  (BB, short stack)
    const config: GameConfig = {
      gameId: 'game_under_raise',
      handId: 'hand_under_raise',
      smallBlind: 50,
      bigBlind: 100,
      dealerSeat: 0,
      seats: [
        { seatIndex: 0, botId: 'b0', botName: 'Dealer', stack: 5000 },
        { seatIndex: 1, botId: 'b1', botName: 'SB', stack: 5000 },
        { seatIndex: 2, botId: 'b2', botName: 'ShortBB', stack: 150 }
      ],
      seed: 9999
    };

    let state = PokerEngine.createGame(config);
    // Preflop:
    // SB (1) posts 50, BB (2) posts 100 (50 chips remaining)
    // Dealer (0) acts first
    expect(state.currentTurnSeat).toBe(0);

    // Dealer raises to 1000
    const step1 = PokerEngine.step(state, { action: 'raise', amount: 1000 });
    state = step1.state;
    expect(state.currentHighestBet).toBe(1000);
    expect(state.currentTurnSeat).toBe(1);

    // SB calls 1000 (puts in 950 more)
    const step2 = PokerEngine.step(state, { action: 'call' });
    state = step2.state;
    expect(state.currentTurnSeat).toBe(2);

    // ShortBB (seat 2) has only 50 chips left, goes all-in for 150 total
    const step3 = PokerEngine.step(state, { action: 'call' });
    state = step3.state;

    // Both Dealer (0) and SB (1) already called/bet 1000, and BB was all in for 150 (less than 1000).
    // The round should have concluded and advanced to Flop!
    expect(state.stage).toBe('flop');
    expect(state.communityCards.length).toBe(3);
  });
});
