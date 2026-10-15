import { Card, HandCategory, HandRankResult } from './types.js';
import { parseCard, VALUE_TO_RANK } from './cards.js';

interface ParsedCard {
  card: Card;
  value: number; // 2..14
  suit: string;
}

const CATEGORY_NAMES: Record<HandCategory, string> = {
  [HandCategory.StraightFlush]: 'Straight Flush',
  [HandCategory.FourOfAKind]: 'Four of a Kind',
  [HandCategory.FullHouse]: 'Full House',
  [HandCategory.Flush]: 'Flush',
  [HandCategory.Straight]: 'Straight',
  [HandCategory.ThreeOfAKind]: 'Three of a Kind',
  [HandCategory.TwoPair]: 'Two Pair',
  [HandCategory.OnePair]: 'One Pair',
  [HandCategory.HighCard]: 'High Card'
};

const RANK_PLURAL_NAMES: Record<number, string> = {
  2: 'Deuces',
  3: 'Threes',
  4: 'Fours',
  5: 'Fives',
  6: 'Sixes',
  7: 'Sevens',
  8: 'Eights',
  9: 'Nines',
  10: 'Tens',
  11: 'Jacks',
  12: 'Queens',
  13: 'Kings',
  14: 'Aces'
};

const RANK_SINGULAR_NAMES: Record<number, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'Jack',
  12: 'Queen',
  13: 'King',
  14: 'Ace'
};

function scoreFiveCards(cards: ParsedCard[]): { score: number; category: HandCategory; description: string } {
  // Sort cards descending by rank value
  cards.sort((a, b) => b.value - a.value);

  const isFlush = cards.every(c => c.suit === cards[0].suit);

  // Check straight
  let isStraight = false;
  let straightHigh = 0;

  // Standard straight check
  if (
    cards[0].value - cards[1].value === 1 &&
    cards[1].value - cards[2].value === 1 &&
    cards[2].value - cards[3].value === 1 &&
    cards[3].value - cards[4].value === 1
  ) {
    isStraight = true;
    straightHigh = cards[0].value;
  } else if (
    // Wheel check: A, 5, 4, 3, 2
    cards[0].value === 14 &&
    cards[1].value === 5 &&
    cards[2].value === 4 &&
    cards[3].value === 3 &&
    cards[4].value === 2
  ) {
    isStraight = true;
    straightHigh = 5; // 5-high straight
  }

  // Straight flush
  if (isFlush && isStraight) {
    const score = (HandCategory.StraightFlush << 20) | (straightHigh << 16);
    const desc = straightHigh === 14
      ? 'Royal Flush'
      : `Straight Flush, ${RANK_SINGULAR_NAMES[straightHigh]} High`;
    return { score, category: HandCategory.StraightFlush, description: desc };
  }

  // Count rank frequencies
  const counts = new Map<number, number>();
  for (const c of cards) {
    counts.set(c.value, (counts.get(c.value) || 0) + 1);
  }

  // Group by frequency descending, then by value descending
  const freqGroups: Array<{ value: number; count: number }> = [];
  for (const [val, cnt] of counts.entries()) {
    freqGroups.push({ value: val, count: cnt });
  }
  freqGroups.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.value - a.value;
  });

  // Four of a kind
  if (freqGroups[0].count === 4) {
    const quadVal = freqGroups[0].value;
    const kicker = freqGroups[1].value;
    const score = (HandCategory.FourOfAKind << 20) | (quadVal << 16) | (kicker << 12);
    const desc = `Four of a Kind, ${RANK_PLURAL_NAMES[quadVal]}`;
    return { score, category: HandCategory.FourOfAKind, description: desc };
  }

  // Full house
  if (freqGroups[0].count === 3 && freqGroups[1].count === 2) {
    const tripsVal = freqGroups[0].value;
    const pairVal = freqGroups[1].value;
    const score = (HandCategory.FullHouse << 20) | (tripsVal << 16) | (pairVal << 12);
    const desc = `Full House, ${RANK_PLURAL_NAMES[tripsVal]} full of ${RANK_PLURAL_NAMES[pairVal]}`;
    return { score, category: HandCategory.FullHouse, description: desc };
  }

  // Flush
  if (isFlush) {
    const score =
      (HandCategory.Flush << 20) |
      (cards[0].value << 16) |
      (cards[1].value << 12) |
      (cards[2].value << 8) |
      (cards[3].value << 4) |
      cards[4].value;
    const desc = `Flush, ${RANK_SINGULAR_NAMES[cards[0].value]} High`;
    return { score, category: HandCategory.Flush, description: desc };
  }

  // Straight
  if (isStraight) {
    const score = (HandCategory.Straight << 20) | (straightHigh << 16);
    const desc = `Straight, ${RANK_SINGULAR_NAMES[straightHigh]} High`;
    return { score, category: HandCategory.Straight, description: desc };
  }

  // Three of a kind
  if (freqGroups[0].count === 3) {
    const tripsVal = freqGroups[0].value;
    const k1 = freqGroups[1].value;
    const k2 = freqGroups[2].value;
    const score = (HandCategory.ThreeOfAKind << 20) | (tripsVal << 16) | (k1 << 12) | (k2 << 8);
    const desc = `Three of a Kind, ${RANK_PLURAL_NAMES[tripsVal]}`;
    return { score, category: HandCategory.ThreeOfAKind, description: desc };
  }

  // Two pair
  if (freqGroups[0].count === 2 && freqGroups[1].count === 2) {
    const highPair = freqGroups[0].value;
    const lowPair = freqGroups[1].value;
    const kicker = freqGroups[2].value;
    const score = (HandCategory.TwoPair << 20) | (highPair << 16) | (lowPair << 12) | (kicker << 8);
    const desc = `Two Pair, ${RANK_PLURAL_NAMES[highPair]} and ${RANK_PLURAL_NAMES[lowPair]}`;
    return { score, category: HandCategory.TwoPair, description: desc };
  }

  // One pair
  if (freqGroups[0].count === 2) {
    const pairVal = freqGroups[0].value;
    const k1 = freqGroups[1].value;
    const k2 = freqGroups[2].value;
    const k3 = freqGroups[3].value;
    const score =
      (HandCategory.OnePair << 20) |
      (pairVal << 16) |
      (k1 << 12) |
      (k2 << 8) |
      (k3 << 4);
    const desc = `Pair of ${RANK_PLURAL_NAMES[pairVal]}`;
    return { score, category: HandCategory.OnePair, description: desc };
  }

  // High card
  const score =
    (HandCategory.HighCard << 20) |
    (cards[0].value << 16) |
    (cards[1].value << 12) |
    (cards[2].value << 8) |
    (cards[3].value << 4) |
    cards[4].value;
  const desc = `High Card, ${RANK_SINGULAR_NAMES[cards[0].value]}`;
  return { score, category: HandCategory.HighCard, description: desc };
}

function getCombinations<T>(array: T[], k: number): T[][] {
  const result: T[][] = [];
  function backtrack(start: number, combo: T[]) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < array.length; i++) {
      combo.push(array[i]);
      backtrack(i + 1, combo);
      combo.pop();
    }
  }
  backtrack(0, []);
  return result;
}

/**
 * Evaluates best 5-card poker hand from 5 to 7 cards.
 */
export function evaluateHand(cards: Card[]): HandRankResult {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`Invalid number of cards for hand evaluation: ${cards.length} (expected 5 to 7)`);
  }

  const parsed: ParsedCard[] = cards.map(c => {
    const p = parseCard(c);
    return { card: c, value: p.value, suit: p.suit };
  });

  const combos = getCombinations(parsed, 5);
  let bestScore = -1;
  let bestResult: HandRankResult = {
    score: 0,
    category: HandCategory.HighCard,
    description: '',
    bestFiveCards: []
  };

  for (const combo of combos) {
    // Clone before scoring because scoreFiveCards sorts in place
    const copy = [...combo];
    const scored = scoreFiveCards(copy);
    if (scored.score > bestScore) {
      bestScore = scored.score;
      bestResult = {
        score: scored.score,
        category: scored.category,
        description: scored.description,
        bestFiveCards: copy.map(c => c.card)
      };
    }
  }

  return bestResult;
}
