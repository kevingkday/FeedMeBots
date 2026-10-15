import { Action, PlayerGameStateV1 } from '../types.js';
import { PRNG } from '../prng.js';
import { parseCard } from '../cards.js';

export type BotDecisionFunction = (state: PlayerGameStateV1) => Action;

/**
 * RandomBot: Uniformly selects any legal action. If raise, chooses a random amount within bounds.
 */
export function createRandomBot(seed?: number | string): BotDecisionFunction {
  const prng = new PRNG(seed ?? Date.now());

  return (state: PlayerGameStateV1): Action => {
    const { legalActions } = state;
    if (legalActions.length === 0) {
      return { action: 'check' };
    }

    const choice = legalActions[prng.nextRange(0, legalActions.length - 1)];
    if (choice.action === 'raise') {
      const min = choice.minAmount!;
      const max = choice.maxAmount!;
      const amount = prng.nextRange(min, max);
      return { action: 'raise', amount };
    }

    return { action: choice.action };
  };
}

/**
 * CallingStationBot: Never raises or folds unless no call/check is available.
 * Checks if toCall === 0, calls if toCall > 0.
 */
export const callingStationBot: BotDecisionFunction = (state: PlayerGameStateV1): Action => {
  const hasCheck = state.legalActions.some(a => a.action === 'check');
  if (hasCheck) {
    return { action: 'check' };
  }
  const hasCall = state.legalActions.some(a => a.action === 'call');
  if (hasCall) {
    return { action: 'call' };
  }
  return { action: 'fold' };
};

/**
 * TightAggressiveBot (TAG):
 * - Preflop: only plays top 20% hands (high pairs 77+, big broadways AK, AQ, AJ, KQ, etc.).
 *   Raises when entered, folds weak cards facing a bet.
 * - Postflop: bets/raises if paired the board or has high cards; checks/calls modest bets; folds to heavy bets with nothing.
 */
export function createTAGBot(seed?: number | string): BotDecisionFunction {
  const prng = new PRNG(seed ?? 424242);

  return (state: PlayerGameStateV1): Action => {
    const { holeCards, stage, legalActions, toCall, minRaiseTo, maxRaiseTo } = state;
    const canCheck = legalActions.some(a => a.action === 'check');
    const canCall = legalActions.some(a => a.action === 'call');
    const canRaise = legalActions.some(a => a.action === 'raise');

    if (!holeCards || holeCards.length < 2) {
      return canCheck ? { action: 'check' } : { action: 'fold' };
    }

    const c1 = parseCard(holeCards[0]);
    const c2 = parseCard(holeCards[1]);
    const isPair = c1.value === c2.value;
    const highVal = Math.max(c1.value, c2.value);
    const lowVal = Math.min(c1.value, c2.value);

    // Preflop decision
    if (stage === 'preflop') {
      const isStrongHand =
        isPair ||
        highVal >= 13 || // Ace or King
        (highVal >= 11 && lowVal >= 10); // QJ, QT, JT

      if (!isStrongHand) {
        if (canCheck) return { action: 'check' };
        // Limped or cheap call? If toCall is small relative to stack, occasionally call, else fold
        if (toCall <= state.bigBlind && canCall && prng.nextFloat() < 0.25) {
          return { action: 'call' };
        }
        return { action: 'fold' };
      }

      // Strong hand: Aggressive raise
      if (canRaise && minRaiseTo !== null && maxRaiseTo !== null) {
        // Standard 3x BB raise
        const targetRaise = Math.min(maxRaiseTo, Math.max(minRaiseTo, state.bigBlind * 3));
        return { action: 'raise', amount: targetRaise };
      }

      if (canCall) return { action: 'call' };
      if (canCheck) return { action: 'check' };
      return { action: 'fold' };
    }

    // Postflop decision
    const boardCards = state.communityCards.map(parseCard);
    const hasPairOnBoard = boardCards.some(b => b.value === c1.value || b.value === c2.value);
    const hasOvercard = highVal > Math.max(...boardCards.map(b => b.value), 0);

    if (isPair || hasPairOnBoard) {
      // Made pair or set! Value bet/raise
      if (canRaise && minRaiseTo !== null && maxRaiseTo !== null && prng.nextFloat() < 0.6) {
        const betAmount = Math.min(maxRaiseTo, Math.max(minRaiseTo, Math.floor(state.pot * 0.66)));
        return { action: 'raise', amount: betAmount };
      }
      if (canCheck) return { action: 'check' };
      if (canCall) return { action: 'call' };
    }

    if (hasOvercard || canCheck) {
      if (canCheck) return { action: 'check' };
      if (canCall && toCall <= state.bigBlind * 2) return { action: 'call' };
    }

    return canCheck ? { action: 'check' } : { action: 'fold' };
  };
}
