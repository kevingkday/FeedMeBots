import {
  Action,
  Card,
  GameConfig,
  HandRankResult,
  InternalGameState,
  PlayerGameStateV1,
  PlayerSeatView,
  Seat,
  Stage
} from './types.js';
import { PRNG } from './prng.js';
import { createShuffledDeck } from './cards.js';
import { evaluateHand } from './evaluator.js';
import { awardPots, calculatePots } from './pots.js';
import { getLegalActions, validateAction } from './rules.js';

export class PokerEngine {
  /**
   * Initializes a new deterministic 6-max No-Limit Texas Hold'em hand.
   */
  public static createGame(config: GameConfig): InternalGameState {
    if (config.seats.length < 2 || config.seats.length > 6) {
      throw new Error(`Invalid seat count: ${config.seats.length}. Expected 2 to 6 seats.`);
    }

    const prng = new PRNG(config.seed);
    const deck = createShuffledDeck(prng);

    const seats: Seat[] = config.seats.map(s => ({
      seatIndex: s.seatIndex,
      botId: s.botId,
      botName: s.botName,
      stack: s.stack,
      currentBet: 0,
      totalInvestedThisHand: 0,
      status: s.stack > 0 ? 'active' : 'sitting_out'
    }));

    // Deal 2 hole cards to each active seat
    for (const seat of seats) {
      if (seat.status === 'active') {
        const c1 = deck.pop()!;
        const c2 = deck.pop()!;
        seat.holeCards = [c1, c2];
      }
    }

    // Determine positions
    const activeSeats = seats.filter(s => s.status === 'active');
    const isHeadsUp = activeSeats.length === 2;

    let sbSeat: number;
    let bbSeat: number;

    if (isHeadsUp) {
      // In heads-up, button is small blind, other seat is big blind
      sbSeat = config.dealerSeat;
      bbSeat = this.findNextSeat(seats, sbSeat, s => s.status === 'active');
    } else {
      sbSeat = this.findNextSeat(seats, config.dealerSeat, s => s.status === 'active');
      bbSeat = this.findNextSeat(seats, sbSeat, s => s.status === 'active');
    }

    const actionHistory: InternalGameState['actionHistory'] = [];

    // Post Small Blind
    const sb = seats.find(s => s.seatIndex === sbSeat)!;
    const sbPost = Math.min(sb.stack, config.smallBlind);
    sb.stack -= sbPost;
    sb.currentBet = sbPost;
    sb.totalInvestedThisHand = sbPost;
    if (sb.stack === 0) sb.status = 'all_in';
    actionHistory.push({
      stage: 'preflop',
      seatIndex: sbSeat,
      action: 'post_sb',
      amount: sbPost
    });

    // Post Big Blind
    const bb = seats.find(s => s.seatIndex === bbSeat)!;
    const bbPost = Math.min(bb.stack, config.bigBlind);
    bb.stack -= bbPost;
    bb.currentBet = bbPost;
    bb.totalInvestedThisHand = bbPost;
    if (bb.stack === 0) bb.status = 'all_in';
    actionHistory.push({
      stage: 'preflop',
      seatIndex: bbSeat,
      action: 'post_bb',
      amount: bbPost
    });

    const currentHighestBet = Math.max(sbPost, bbPost);

    // Initial preflop action
    let firstTurnSeat: number;
    if (isHeadsUp) {
      firstTurnSeat = sbSeat; // Dealer acts first preflop in heads up
    } else {
      firstTurnSeat = this.findNextSeat(seats, bbSeat, s => s.status === 'active');
    }

    const actionClosedSeats = new Array(6).fill(false);
    const { pots } = calculatePots(seats);

    const state: InternalGameState = {
      version: 'v1',
      gameId: config.gameId,
      handId: config.handId,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
      dealerSeat: config.dealerSeat,
      smallBlindSeat: sbSeat,
      bigBlindSeat: bbSeat,
      currentTurnSeat: firstTurnSeat,
      stage: 'preflop',
      communityCards: [],
      deck,
      seats,
      actionHistory,
      currentHighestBet,
      minRaiseDelta: config.bigBlind,
      lastBettorSeat: null,
      actionClosedSeats,
      pots
    };

    // If game has only 1 active player left (e.g. all others are all-in or sitting out), advance
    const activeCount = seats.filter(s => s.status === 'active').length;
    if (activeCount <= 1) {
      this.checkAndAdvanceBettingRound(state);
    }

    return state;
  }

  /**
   * Advances the game state by executing an action for the player whose turn it is.
   */
  public static step(state: InternalGameState, action: Action): { state: InternalGameState; error?: string } {
    if (state.stage === 'ended' || state.currentTurnSeat === null) {
      return { state, error: 'Hand has already ended' };
    }

    const heroSeat = state.seats.find(s => s.seatIndex === state.currentTurnSeat);
    if (!heroSeat) {
      return { state, error: `Seat ${state.currentTurnSeat} not found` };
    }

    const validation = validateAction(state, heroSeat.seatIndex, action);
    if (!validation.valid) {
      return { state, error: validation.error };
    }

    // Deep clone state to ensure pure immutability
    const nextState: InternalGameState = JSON.parse(JSON.stringify(state));
    const hero = nextState.seats.find(s => s.seatIndex === nextState.currentTurnSeat)!;

    switch (action.action) {
      case 'fold': {
        hero.status = 'folded';
        nextState.actionHistory.push({
          stage: nextState.stage,
          seatIndex: hero.seatIndex,
          action: 'fold'
        });

        // Check if only 1 contender remains
        const contenders = nextState.seats.filter(s => s.status === 'active' || s.status === 'all_in');
        if (contenders.length === 1) {
          // Hand ends immediately; last player wins
          this.awardUncontestedPot(nextState, contenders[0]);
          return { state: nextState };
        }
        break;
      }

      case 'check': {
        nextState.actionHistory.push({
          stage: nextState.stage,
          seatIndex: hero.seatIndex,
          action: 'check'
        });
        break;
      }

      case 'call': {
        const toCall = nextState.currentHighestBet - hero.currentBet;
        const callAmount = Math.min(hero.stack, toCall);
        hero.stack -= callAmount;
        hero.currentBet += callAmount;
        hero.totalInvestedThisHand += callAmount;
        if (hero.stack === 0) hero.status = 'all_in';

        nextState.actionHistory.push({
          stage: nextState.stage,
          seatIndex: hero.seatIndex,
          action: 'call',
          amount: callAmount
        });
        break;
      }

      case 'raise': {
        const raiseTo = action.amount!;
        const delta = raiseTo - hero.currentBet;
        hero.stack -= delta;
        hero.currentBet = raiseTo;
        hero.totalInvestedThisHand += delta;
        if (hero.stack === 0) hero.status = 'all_in';

        const raiseDelta = hero.currentBet - nextState.currentHighestBet;
        if (raiseDelta >= nextState.minRaiseDelta) {
          // Full raise: reopens betting action
          nextState.minRaiseDelta = raiseDelta;
          nextState.lastBettorSeat = hero.seatIndex;
          nextState.actionClosedSeats = nextState.actionClosedSeats.map(() => false);
        } else {
          // Under-raise all-in: does not reopen action for players who already matched previous bet
          for (const s of nextState.seats) {
            if (s.status === 'active' && s.currentBet === nextState.currentHighestBet && s.seatIndex !== hero.seatIndex) {
              nextState.actionClosedSeats[s.seatIndex] = true;
            }
          }
        }

        nextState.currentHighestBet = hero.currentBet;
        nextState.actionHistory.push({
          stage: nextState.stage,
          seatIndex: hero.seatIndex,
          action: 'raise',
          amount: raiseTo
        });
        break;
      }
    }

    // Update pots
    const { pots } = calculatePots(nextState.seats);
    nextState.pots = pots;

    // Check if betting round has concluded
    this.checkAndAdvanceBettingRound(nextState);

    return { state: nextState };
  }

  private static checkAndAdvanceBettingRound(state: InternalGameState): void {
    const activeSeats = state.seats.filter(s => s.status === 'active');
    const contenders = state.seats.filter(s => s.status === 'active' || s.status === 'all_in');

    if (contenders.length <= 1) {
      if (contenders.length === 1) {
        this.awardUncontestedPot(state, contenders[0]);
      } else {
        state.stage = 'ended';
        state.currentTurnSeat = null;
      }
      return;
    }

    // If 0 active players (all contenders are all-in), deal to river and showdown
    if (activeSeats.length === 0) {
      this.dealRemainingCardsAndShowdown(state);
      return;
    }

    // If only 1 active player and all other contenders are all-in:
    // If the active player's bet is >= highest bet, no more betting is possible
    if (activeSeats.length === 1) {
      const singleActive = activeSeats[0];
      const highestAllInBet = Math.max(
        ...state.seats.filter(s => s.status === 'all_in').map(s => s.currentBet),
        0
      );
      if (singleActive.currentBet >= highestAllInBet) {
        this.dealRemainingCardsAndShowdown(state);
        return;
      }
    }

    // Check if every active player has acted in this stage and matched currentHighestBet
    const stageActions = state.actionHistory.filter(a => a.stage === state.stage && a.action !== 'post_sb' && a.action !== 'post_bb');
    const hasEveryoneActed = activeSeats.every(s => stageActions.some(a => a.seatIndex === s.seatIndex));
    const hasEveryoneMatchedBet = activeSeats.every(s => s.currentBet === state.currentHighestBet);

    if (hasEveryoneActed && hasEveryoneMatchedBet) {
      // Betting round is complete!
      this.advanceToNextStage(state);
    } else {
      // Move to next active player
      state.currentTurnSeat = this.findNextSeat(state.seats, state.currentTurnSeat!, s => s.status === 'active');
    }
  }

  private static advanceToNextStage(state: InternalGameState): void {
    // Reset round bets
    for (const seat of state.seats) {
      seat.currentBet = 0;
    }
    state.currentHighestBet = 0;
    state.minRaiseDelta = state.bigBlind;
    state.lastBettorSeat = null;
    state.actionClosedSeats = state.actionClosedSeats.map(() => false);

    const { pots } = calculatePots(state.seats);
    state.pots = pots;

    // Advance stage
    if (state.stage === 'preflop') {
      state.stage = 'flop';
      state.deck.pop(); // Burn card
      state.communityCards.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
    } else if (state.stage === 'flop') {
      state.stage = 'turn';
      state.deck.pop(); // Burn card
      state.communityCards.push(state.deck.pop()!);
    } else if (state.stage === 'turn') {
      state.stage = 'river';
      state.deck.pop(); // Burn card
      state.communityCards.push(state.deck.pop()!);
    } else if (state.stage === 'river') {
      this.executeShowdown(state);
      return;
    }

    // Check if further betting is possible
    const activeSeats = state.seats.filter(s => s.status === 'active');
    if (activeSeats.length <= 1) {
      this.checkAndAdvanceBettingRound(state);
      return;
    }

    // Postflop action starts with first active player clockwise from dealer button
    state.currentTurnSeat = this.findNextSeat(state.seats, state.dealerSeat, s => s.status === 'active');
  }

  private static dealRemainingCardsAndShowdown(state: InternalGameState): void {
    // Deal community cards up to 5
    while (state.communityCards.length < 5) {
      state.deck.pop(); // Burn
      if (state.communityCards.length === 0) {
        state.communityCards.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
      } else {
        state.communityCards.push(state.deck.pop()!);
      }
    }
    this.executeShowdown(state);
  }

  private static executeShowdown(state: InternalGameState): void {
    state.stage = 'showdown';
    state.currentTurnSeat = null;

    const { pots, refunds } = calculatePots(state.seats);
    state.pots = pots;

    const contenders = state.seats.filter(s => s.status === 'active' || s.status === 'all_in');
    const rankings = new Map<number, HandRankResult>();

    for (const seat of contenders) {
      if (seat.holeCards) {
        const fullSeven = [...state.communityCards, ...seat.holeCards];
        const rank = evaluateHand(fullSeven);
        rankings.set(seat.seatIndex, rank);
        seat.showdownRank = rank;
      }
    }

    const { payouts } = awardPots(pots, refunds, state.seats, state.dealerSeat, rankings);

    for (const payout of payouts) {
      const winner = state.seats.find(s => s.seatIndex === payout.seatIndex)!;
      winner.stack += payout.amount;
    }

    state.winners = payouts;
    state.stage = 'ended';
  }

  private static awardUncontestedPot(state: InternalGameState, winner: Seat): void {
    const { pots, refunds } = calculatePots(state.seats);

    // Apply any uncalled bet refunds
    for (const ref of refunds) {
      const s = state.seats.find(seat => seat.seatIndex === ref.seatIndex)!;
      s.stack += ref.amount;
    }

    // All pots awarded to single winner
    let totalWon = 0;
    for (const pot of pots) {
      totalWon += pot.amount;
    }
    winner.stack += totalWon;

    state.winners = [
      ...refunds.map(r => ({
        seatIndex: r.seatIndex,
        amount: r.amount,
        potIndex: -1,
        handDescription: 'Uncalled bet refund'
      })),
      {
        seatIndex: winner.seatIndex,
        amount: totalWon,
        potIndex: 0,
        handDescription: 'Uncontested pot'
      }
    ];

    state.stage = 'ended';
    state.currentTurnSeat = null;
  }

  private static findNextSeat(
    seats: Seat[],
    fromSeatIndex: number,
    predicate: (s: Seat) => boolean
  ): number {
    for (let offset = 1; offset <= 6; offset++) {
      const checkSeat = (fromSeatIndex + offset) % 6;
      const s = seats.find(seat => seat.seatIndex === checkSeat);
      if (s && predicate(s)) {
        return checkSeat;
      }
    }
    return fromSeatIndex;
  }

  /**
   * Generates the masked, per-player view matching FeedMeBotsGameStateV1.
   * Conceals opponents' hole cards unless game reached showdown.
   */
  public static getPlayerView(state: InternalGameState, heroSeatIndex: number): PlayerGameStateV1 {
    const hero = state.seats.find(s => s.seatIndex === heroSeatIndex);
    const toCall = hero && hero.status === 'active' ? Math.max(0, state.currentHighestBet - hero.currentBet) : 0;
    const legalActions = state.currentTurnSeat === heroSeatIndex ? getLegalActions(state, heroSeatIndex) : [];

    const raiseAction = legalActions.find(a => a.action === 'raise');

    const totalPot = state.pots.reduce((sum, p) => sum + p.amount, 0);

    const seatViews: PlayerSeatView[] = state.seats.map(s => {
      const isHero = s.seatIndex === heroSeatIndex;
      const showCardsAtEnd = (state.stage === 'ended' || state.stage === 'showdown') && (s.status === 'active' || s.status === 'all_in');

      let cards: Card[] | undefined;
      if (isHero) {
        cards = s.holeCards ? [...s.holeCards] : undefined;
      } else if (showCardsAtEnd && s.holeCards) {
        cards = [...s.holeCards];
      }

      return {
        seatIndex: s.seatIndex,
        botId: s.botId,
        botName: s.botName,
        stack: s.stack,
        currentBet: s.currentBet,
        status: s.status,
        holeCards: cards
      };
    });

    return {
      version: 'v1',
      gameId: state.gameId,
      handId: state.handId,
      seatIndex: heroSeatIndex,
      dealerSeat: state.dealerSeat,
      smallBlindSeat: state.smallBlindSeat,
      bigBlindSeat: state.bigBlindSeat,
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      stage: state.stage,
      communityCards: [...state.communityCards],
      holeCards: hero && hero.holeCards ? [...hero.holeCards] : [],
      pot: totalPot,
      sidePots: state.pots.map(p => ({ amount: p.amount, eligibleSeats: [...p.eligibleSeats] })),
      toCall,
      minRaiseTo: raiseAction?.minAmount ?? null,
      maxRaiseTo: raiseAction?.maxAmount ?? null,
      legalActions,
      seats: seatViews,
      actionHistory: state.actionHistory.map(a => ({ ...a }))
    };
  }

  /**
   * Invariant helper: Verifies total chip count is strictly conserved.
   */
  public static verifyChipConservation(initialTotalChips: number, state: InternalGameState): boolean {
    const seatChips = state.seats.reduce((sum, s) => sum + s.stack, 0);
    return seatChips === initialTotalChips;
  }
}
