export type Suit = 's' | 'h' | 'd' | 'c';
export type RankChar = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Card = `${RankChar}${Suit}`;

export type Stage = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'ended';

export type ActionType = 'fold' | 'check' | 'call' | 'raise';

export interface Action {
  action: ActionType;
  amount?: number; // total bet amount for the round ("raise to" amount)
}

export type SeatStatus = 'active' | 'folded' | 'all_in' | 'sitting_out' | 'empty';

export interface Seat {
  seatIndex: number;
  botId: string;
  botName: string;
  stack: number;
  currentBet: number;
  totalInvestedThisHand: number;
  status: SeatStatus;
  holeCards?: [Card, Card];
  showdownRank?: HandRankResult;
}

export interface ActionRecord {
  stage: Stage;
  seatIndex: number;
  action: 'post_sb' | 'post_bb' | 'fold' | 'check' | 'call' | 'raise';
  amount?: number;
}

export interface SidePot {
  amount: number;
  eligibleSeats: number[];
}

export interface LegalAction {
  action: ActionType;
  minAmount?: number;
  maxAmount?: number;
}

export interface HandRankResult {
  score: number;
  category: HandCategory;
  description: string;
  bestFiveCards: Card[];
}

export enum HandCategory {
  HighCard = 1,
  OnePair = 2,
  TwoPair = 3,
  ThreeOfAKind = 4,
  Straight = 5,
  Flush = 6,
  FullHouse = 7,
  FourOfAKind = 8,
  StraightFlush = 9
}

export interface GameConfig {
  gameId: string;
  handId: string;
  smallBlind: number;
  bigBlind: number;
  dealerSeat: number;
  seats: Array<{
    seatIndex: number;
    botId: string;
    botName: string;
    stack: number;
  }>;
  seed: number | string;
}

export interface InternalGameState {
  version: 'v1';
  gameId: string;
  handId: string;
  smallBlind: number;
  bigBlind: number;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  currentTurnSeat: number | null;
  stage: Stage;
  communityCards: Card[];
  deck: Card[];
  seats: Seat[];
  actionHistory: ActionRecord[];
  currentHighestBet: number;
  minRaiseDelta: number;
  lastBettorSeat: number | null;
  actionClosedSeats: boolean[]; // tracks who closed action if under-raise all-in
  pots: SidePot[];
  winners?: Array<{
    seatIndex: number;
    amount: number;
    potIndex: number;
    handDescription?: string;
  }>;
}

export interface PlayerSeatView {
  seatIndex: number;
  botId: string;
  botName: string;
  stack: number;
  currentBet: number;
  status: SeatStatus;
  holeCards?: Card[];
}

export interface PlayerGameStateV1 {
  version: 'v1';
  gameId: string;
  handId: string;
  seatIndex: number;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  smallBlind: number;
  bigBlind: number;
  stage: Stage;
  communityCards: Card[];
  holeCards: Card[];
  pot: number;
  sidePots: SidePot[];
  toCall: number;
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
  legalActions: LegalAction[];
  seats: PlayerSeatView[];
  actionHistory: ActionRecord[];
}
