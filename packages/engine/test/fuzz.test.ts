import { describe, expect, it } from 'vitest';
import { PokerEngine } from '../src/engine.js';
import { Action, GameConfig } from '../src/types.js';
import { PRNG } from '../src/prng.js';
import { getLegalActions } from '../src/rules.js';

describe('Engine Fuzz Testing', () => {
  it('runs 2,500 random hands across varying table sizes without error or chip leaks', () => {
    const prng = new PRNG(888123);
    const HANDS_TO_TEST = 2500;

    for (let handIndex = 0; handIndex < HANDS_TO_TEST; handIndex++) {
      const playerCount = prng.nextRange(2, 6);
      const seats = [];
      let totalInitialChips = 0;

      for (let s = 0; s < playerCount; s++) {
        // Vary stack sizes: short (100-300), mid (500-1500), deep (2000-10000)
        const stackTier = prng.nextRange(0, 2);
        let stack: number;
        if (stackTier === 0) stack = prng.nextRange(100, 300);
        else if (stackTier === 1) stack = prng.nextRange(500, 1500);
        else stack = prng.nextRange(2000, 10000);

        totalInitialChips += stack;
        seats.push({
          seatIndex: s,
          botId: `fuzz_bot_${s}`,
          botName: `FuzzBot${s}`,
          stack
        });
      }

      const dealerSeat = prng.nextRange(0, playerCount - 1);
      const config: GameConfig = {
        gameId: `fuzz_game_${handIndex}`,
        handId: `fuzz_hand_${handIndex}`,
        smallBlind: 25,
        bigBlind: 50,
        dealerSeat,
        seats,
        seed: prng.nextInt()
      };

      let state = PokerEngine.createGame(config);
      let stepCount = 0;
      const MAX_STEPS = 200;

      while (state.stage !== 'ended' && state.currentTurnSeat !== null) {
        stepCount++;
        if (stepCount > MAX_STEPS) {
          throw new Error(`Hand ${handIndex} exceeded maximum steps (${MAX_STEPS}). Potential infinite loop!`);
        }

        const turnSeat = state.currentTurnSeat;
        const legalActions = getLegalActions(state, turnSeat);
        if (legalActions.length === 0) {
          throw new Error(`Seat ${turnSeat} has turn to act but 0 legal actions! State: ${JSON.stringify(state)}`);
        }

        // Pick a random legal action
        const chosenLegal = legalActions[prng.nextRange(0, legalActions.length - 1)];
        let action: Action;

        if (chosenLegal.action === 'raise') {
          const min = chosenLegal.minAmount!;
          const max = chosenLegal.maxAmount!;
          const raiseAmount = prng.nextRange(min, max);
          action = { action: 'raise', amount: raiseAmount };
        } else {
          action = { action: chosenLegal.action };
        }

        const stepResult = PokerEngine.step(state, action);
        if (stepResult.error) {
          throw new Error(`Step error in hand ${handIndex} at step ${stepCount}: ${stepResult.error}`);
        }
        state = stepResult.state;
      }

      // Assert conservation of chips
      const finalTotalChips = state.seats.reduce((sum, s) => sum + s.stack, 0);
      expect(finalTotalChips).toBe(totalInitialChips);
    }
  });
});
