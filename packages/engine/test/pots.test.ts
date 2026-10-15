import { describe, expect, it } from 'vitest';
import { awardPots, calculatePots } from '../src/pots.js';
import { HandCategory, HandRankResult, Seat } from '../src/types.js';

describe('Pot and Side Pot Engine', () => {
  it('calculates main pot and side pots for unequal all-ins with uncalled bet refund', () => {
    const seats: Seat[] = [
      {
        seatIndex: 0,
        botId: 'bot0',
        botName: 'ShortStack',
        stack: 0,
        currentBet: 100,
        totalInvestedThisHand: 100,
        status: 'all_in'
      },
      {
        seatIndex: 1,
        botId: 'bot1',
        botName: 'MidStack',
        stack: 0,
        currentBet: 250,
        totalInvestedThisHand: 250,
        status: 'all_in'
      },
      {
        seatIndex: 2,
        botId: 'bot2',
        botName: 'DeepStack',
        stack: 500,
        currentBet: 500,
        totalInvestedThisHand: 500,
        status: 'active'
      }
    ];

    const { pots, refunds } = calculatePots(seats);

    expect(pots.length).toBe(2);

    // Main pot: 100 from each player = 300
    expect(pots[0].amount).toBe(300);
    expect(pots[0].eligibleSeats).toEqual([0, 1, 2]);

    // Side pot: 150 from seat 1 and seat 2 = 300
    expect(pots[1].amount).toBe(300);
    expect(pots[1].eligibleSeats).toEqual([1, 2]);

    // Uncalled bet refund: 250 back to seat 2
    expect(refunds.length).toBe(1);
    expect(refunds[0].seatIndex).toBe(2);
    expect(refunds[0].amount).toBe(250);

    // Total chips = 300 + 300 + 250 = 850
    const totalChipsInvolved = pots.reduce((sum, p) => sum + p.amount, 0) + refunds.reduce((sum, r) => sum + r.amount, 0);
    expect(totalChipsInvolved).toBe(850);
  });

  it('correctly divides split pots and awards odd chip clockwise from dealer button', () => {
    const pots = [{ amount: 101, eligibleSeats: [1, 2] }];
    const refunds: Array<{ seatIndex: number; amount: number }> = [];
    const seats: Seat[] = [
      { seatIndex: 0, botId: 'b0', botName: 'Dealer', stack: 1000, currentBet: 0, totalInvestedThisHand: 0, status: 'sitting_out' },
      { seatIndex: 1, botId: 'b1', botName: 'Player1', stack: 0, currentBet: 0, totalInvestedThisHand: 50, status: 'active' },
      { seatIndex: 2, botId: 'b2', botName: 'Player2', stack: 0, currentBet: 0, totalInvestedThisHand: 51, status: 'active' }
    ];

    // Tied hands
    const rankings = new Map<number, HandRankResult>();
    const tiedRank: HandRankResult = {
      score: 10000,
      category: HandCategory.OnePair,
      description: 'Pair of Aces',
      bestFiveCards: ['As', 'Ah', 'Kd', 'Qc', 'Jd']
    };
    rankings.set(1, tiedRank);
    rankings.set(2, tiedRank);

    // Dealer is seat 0.
    // Clockwise from button: seat 1 is distance 1, seat 2 is distance 2.
    // So seat 1 should get the odd chip (51 chips), and seat 2 gets 50 chips.
    const { payouts, totalAwarded } = awardPots(pots, refunds, seats, 0, rankings);

    expect(totalAwarded).toBe(101);
    const payout1 = payouts.find(p => p.seatIndex === 1);
    const payout2 = payouts.find(p => p.seatIndex === 2);

    expect(payout1?.amount).toBe(51);
    expect(payout2?.amount).toBe(50);
  });

  it('awards odd chip to seat 2 if dealer is seat 1', () => {
    const pots = [{ amount: 75, eligibleSeats: [0, 2] }];
    const refunds: Array<{ seatIndex: number; amount: number }> = [];
    const seats: Seat[] = [
      { seatIndex: 0, botId: 'b0', botName: 'Player0', stack: 0, currentBet: 0, totalInvestedThisHand: 37, status: 'active' },
      { seatIndex: 1, botId: 'b1', botName: 'Dealer', stack: 1000, currentBet: 0, totalInvestedThisHand: 0, status: 'sitting_out' },
      { seatIndex: 2, botId: 'b2', botName: 'Player2', stack: 0, currentBet: 0, totalInvestedThisHand: 38, status: 'active' }
    ];

    const rankings = new Map<number, HandRankResult>();
    const tiedRank: HandRankResult = {
      score: 10000,
      category: HandCategory.OnePair,
      description: 'Pair of Aces',
      bestFiveCards: ['As', 'Ah', 'Kd', 'Qc', 'Jd']
    };
    rankings.set(0, tiedRank);
    rankings.set(2, tiedRank);

    // Dealer is seat 1.
    // Clockwise from seat 1:
    // Seat 2 is distance 1.
    // Seat 0 is distance 5.
    // Seat 2 gets the odd chip! 75 / 2 = 37 with 1 remainder -> seat 2 gets 38, seat 0 gets 37.
    const { payouts, totalAwarded } = awardPots(pots, refunds, seats, 1, rankings);

    expect(totalAwarded).toBe(75);
    const p0 = payouts.find(p => p.seatIndex === 0);
    const p2 = payouts.find(p => p.seatIndex === 2);

    expect(p2?.amount).toBe(38);
    expect(p0?.amount).toBe(37);
  });
});
