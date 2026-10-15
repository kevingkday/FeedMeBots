import { Card, RankChar, Suit } from './types.js';
import { PRNG } from './prng.js';

export const SUITS: Suit[] = ['s', 'h', 'd', 'c'];
export const RANKS: RankChar[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

export const RANK_VALUES: Record<RankChar, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  'T': 10,
  'J': 11,
  'Q': 12,
  'K': 13,
  'A': 14
};

export const VALUE_TO_RANK: Record<number, RankChar> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'T',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A'
};

export function parseCard(card: string): { rank: RankChar; suit: Suit; value: number } {
  if (card.length !== 2) {
    throw new Error(`Invalid card string: ${card}`);
  }
  const rank = card[0] as RankChar;
  const suit = card[1] as Suit;
  const value = RANK_VALUES[rank];
  if (!value || !SUITS.includes(suit)) {
    throw new Error(`Invalid card components: ${card}`);
  }
  return { rank, suit, value };
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}` as Card);
    }
  }
  return deck;
}

export function createShuffledDeck(prng: PRNG): Card[] {
  const deck = createDeck();
  return prng.shuffle(deck);
}
