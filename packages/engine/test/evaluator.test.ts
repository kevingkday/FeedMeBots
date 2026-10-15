import { describe, expect, it } from 'vitest';
import { evaluateHand } from '../src/evaluator.js';
import { Card, HandCategory } from '../src/types.js';

describe('Hand Evaluator', () => {
  it('correctly classifies a Royal Flush', () => {
    const cards: Card[] = ['As', 'Ks', 'Qs', 'Js', 'Ts', '2c', '3d'];
    const result = evaluateHand(cards);
    expect(result.category).toBe(HandCategory.StraightFlush);
    expect(result.description).toBe('Royal Flush');
  });

  it('correctly classifies a Wheel Straight Flush (5-4-3-2-A)', () => {
    const cards: Card[] = ['5h', '4h', '3h', '2h', 'Ah', 'Kd', 'Tc'];
    const result = evaluateHand(cards);
    expect(result.category).toBe(HandCategory.StraightFlush);
    expect(result.description).toBe('Straight Flush, 5 High');
  });

  it('correctly breaks ties between Straight Flushes', () => {
    const hand1 = evaluateHand(['9s', '8s', '7s', '6s', '5s', '2d', '3c']);
    const hand2 = evaluateHand(['8c', '7c', '6c', '5c', '4c', '2d', '3d']);
    expect(hand1.score).toBeGreaterThan(hand2.score);
  });

  it('correctly classifies Four of a Kind and breaks kicker ties', () => {
    const handA = evaluateHand(['As', 'Ah', 'Ad', 'Ac', 'Kd', '2c', '3c']);
    const handB = evaluateHand(['As', 'Ah', 'Ad', 'Ac', 'Qd', '2c', '3c']);
    expect(handA.category).toBe(HandCategory.FourOfAKind);
    expect(handA.score).toBeGreaterThan(handB.score);
  });

  it('correctly classifies Full House and breaks ties', () => {
    const acesFull = evaluateHand(['As', 'Ah', 'Ad', 'Ks', 'Kh', '2c', '3c']);
    const kingsFull = evaluateHand(['Ks', 'Kh', 'Kd', 'As', 'Ah', '2c', '3c']);
    expect(acesFull.category).toBe(HandCategory.FullHouse);
    expect(kingsFull.category).toBe(HandCategory.FullHouse);
    expect(acesFull.score).toBeGreaterThan(kingsFull.score);
  });

  it('correctly ranks flushes by kicker', () => {
    const flushA = evaluateHand(['As', 'Js', '8s', '6s', '3s', '2h', '4d']);
    const flushB = evaluateHand(['As', 'Ts', '8s', '6s', '3s', '2h', '4d']);
    expect(flushA.category).toBe(HandCategory.Flush);
    expect(flushB.category).toBe(HandCategory.Flush);
    expect(flushA.score).toBeGreaterThan(flushB.score);
  });

  it('correctly identifies standard straights and wheel straights', () => {
    const broadway = evaluateHand(['As', 'Kd', 'Qc', 'Jh', 'Ts', '2c', '3d']);
    const wheel = evaluateHand(['5s', '4d', '3c', '2h', 'As', '8c', '9d']);
    const sixHigh = evaluateHand(['6s', '5d', '4c', '3h', '2s', 'Jc', 'Kd']);

    expect(broadway.category).toBe(HandCategory.Straight);
    expect(wheel.category).toBe(HandCategory.Straight);
    expect(sixHigh.category).toBe(HandCategory.Straight);

    expect(broadway.score).toBeGreaterThan(sixHigh.score);
    expect(sixHigh.score).toBeGreaterThan(wheel.score);
  });

  it('correctly compares two pair kickers', () => {
    const twoPairKickerK = evaluateHand(['As', 'Ah', 'Qs', 'Qh', 'Kd', '2c', '3c']);
    const twoPairKickerJ = evaluateHand(['As', 'Ah', 'Qs', 'Qh', 'Jd', '2c', '3c']);
    expect(twoPairKickerK.category).toBe(HandCategory.TwoPair);
    expect(twoPairKickerK.score).toBeGreaterThan(twoPairKickerJ.score);
  });

  it('identifies identical hands as tied scores', () => {
    const board: Card[] = ['As', 'Kd', 'Qc', 'Jh', 'Ts']; // Broadway on board
    const hand1 = evaluateHand([...board, '2c', '3d']);
    const hand2 = evaluateHand([...board, '4h', '5s']);
    expect(hand1.score).toBe(hand2.score);
  });
});
