import { describe, expect, it } from 'vitest';
import { PokerEngine } from '../src/engine.js';
import { GameConfig } from '../src/types.js';

describe('Engine Invariants', () => {
  it('conserves total chips when hand ends preflop due to folds', () => {
    const config: GameConfig = {
      gameId: 'inv_1',
      handId: 'inv_hand_1',
      smallBlind: 50,
      bigBlind: 100,
      dealerSeat: 0,
      seats: [
        { seatIndex: 0, botId: 'b0', botName: 'B0', stack: 1000 },
        { seatIndex: 1, botId: 'b1', botName: 'B1', stack: 1000 },
        { seatIndex: 2, botId: 'b2', botName: 'B2', stack: 1000 }
      ],
      seed: 42
    };

    const initialTotal = 3000;
    let state = PokerEngine.createGame(config);

    // UTG is dealer (seat 0) in 3-player
    // Seat 0 folds
    let res = PokerEngine.step(state, { action: 'fold' });
    state = res.state;

    // SB (seat 1) folds
    res = PokerEngine.step(state, { action: 'fold' });
    state = res.state;

    expect(state.stage).toBe('ended');
    const finalTotal = state.seats.reduce((sum, s) => sum + s.stack, 0);
    expect(finalTotal).toBe(initialTotal);
    expect(PokerEngine.verifyChipConservation(initialTotal, state)).toBe(true);
  });

  it('conserves total chips in multiway all-in showdown', () => {
    const config: GameConfig = {
      gameId: 'inv_all_in',
      handId: 'inv_all_in_hand',
      smallBlind: 25,
      bigBlind: 50,
      dealerSeat: 0,
      seats: [
        { seatIndex: 0, botId: 'b0', botName: 'B0', stack: 300 },
        { seatIndex: 1, botId: 'b1', botName: 'B1', stack: 500 },
        { seatIndex: 2, botId: 'b2', botName: 'B2', stack: 1200 }
      ],
      seed: 777
    };

    const initialTotal = 300 + 500 + 1200;
    let state = PokerEngine.createGame(config);

    // Seat 0 goes all-in for 300
    state = PokerEngine.step(state, { action: 'raise', amount: 300 }).state;

    // Seat 1 calls all-in for 500
    state = PokerEngine.step(state, { action: 'raise', amount: 500 }).state;

    // Seat 2 calls 500
    state = PokerEngine.step(state, { action: 'call' }).state;

    expect(state.stage).toBe('ended');
    const finalTotal = state.seats.reduce((sum, s) => sum + s.stack, 0);
    expect(finalTotal).toBe(initialTotal);
    expect(PokerEngine.verifyChipConservation(initialTotal, state)).toBe(true);
  });

  it('guarantees 100% deterministic reproducibility with identical seeds', () => {
    const configA: GameConfig = {
      gameId: 'seed_test',
      handId: 'seed_hand_1',
      smallBlind: 50,
      bigBlind: 100,
      dealerSeat: 1,
      seats: [
        { seatIndex: 0, botId: 'b0', botName: 'B0', stack: 2000 },
        { seatIndex: 1, botId: 'b1', botName: 'B1', stack: 2000 },
        { seatIndex: 2, botId: 'b2', botName: 'B2', stack: 2000 }
      ],
      seed: 'deterministic-fixed-seed'
    };

    const configB: GameConfig = {
      ...configA,
      gameId: 'seed_test_clone',
      handId: 'seed_hand_clone'
    };

    let stateA = PokerEngine.createGame(configA);
    let stateB = PokerEngine.createGame(configB);

    expect(stateA.communityCards).toEqual(stateB.communityCards);
    expect(stateA.seats.map(s => s.holeCards)).toEqual(stateB.seats.map(s => s.holeCards));

    // Play same actions
    stateA = PokerEngine.step(stateA, { action: 'call' }).state;
    stateB = PokerEngine.step(stateB, { action: 'call' }).state;

    stateA = PokerEngine.step(stateA, { action: 'call' }).state;
    stateB = PokerEngine.step(stateB, { action: 'call' }).state;

    stateA = PokerEngine.step(stateA, { action: 'check' }).state;
    stateB = PokerEngine.step(stateB, { action: 'check' }).state;

    expect(stateA.communityCards).toEqual(stateB.communityCards);
    expect(stateA.seats.map(s => s.stack)).toEqual(stateB.seats.map(s => s.stack));
  });
});
