import { Action, InternalGameState, LegalAction, Seat } from './types.js';

export function getLegalActions(state: InternalGameState, seatIndex: number): LegalAction[] {
  const seat = state.seats.find(s => s.seatIndex === seatIndex);
  if (!seat || seat.status !== 'active') {
    return [];
  }

  const toCall = state.currentHighestBet - seat.currentBet;
  const actions: LegalAction[] = [];

  // 1. Fold
  if (toCall > 0) {
    actions.push({ action: 'fold' });
  }

  // 2. Check
  if (toCall === 0) {
    actions.push({ action: 'check' });
  }

  // 3. Call
  if (toCall > 0 && seat.stack > 0) {
    actions.push({ action: 'call' });
  }

  // 4. Raise / Bet
  // Can only raise if player has more chips than toCall, and action is not closed for this seat
  const totalChipsAvailable = seat.currentBet + seat.stack;
  const isActionClosed = state.actionClosedSeats[seatIndex] === true;

  if (seat.stack > toCall && !isActionClosed) {
    const minDelta = state.minRaiseDelta > 0 ? state.minRaiseDelta : state.bigBlind;
    const minRaiseTo = state.currentHighestBet + minDelta;

    if (totalChipsAvailable >= minRaiseTo) {
      actions.push({
        action: 'raise',
        minAmount: minRaiseTo,
        maxAmount: totalChipsAvailable
      });
    } else if (totalChipsAvailable > state.currentHighestBet) {
      // All-in raise for less than minimum raise size
      actions.push({
        action: 'raise',
        minAmount: totalChipsAvailable,
        maxAmount: totalChipsAvailable
      });
    }
  }

  return actions;
}

export function validateAction(
  state: InternalGameState,
  seatIndex: number,
  action: Action
): { valid: boolean; error?: string } {
  if (state.currentTurnSeat !== seatIndex) {
    return { valid: false, error: `It is not seat ${seatIndex}'s turn to act (current turn: ${state.currentTurnSeat})` };
  }

  const legalActions = getLegalActions(state, seatIndex);
  const legal = legalActions.find(a => a.action === action.action);

  if (!legal) {
    return {
      valid: false,
      error: `Action '${action.action}' is not legal. Legal actions: ${legalActions.map(a => a.action).join(', ')}`
    };
  }

  if (action.action === 'raise') {
    if (typeof action.amount !== 'number' || isNaN(action.amount)) {
      return { valid: false, error: `Action 'raise' requires a numeric 'amount'` };
    }
    const min = legal.minAmount!;
    const max = legal.maxAmount!;
    if (action.amount < min || action.amount > max) {
      return {
        valid: false,
        error: `Raise amount ${action.amount} is outside allowed range [${min}, ${max}]`
      };
    }
  }

  return { valid: true };
}
