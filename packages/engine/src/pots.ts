import { HandRankResult, Seat, SidePot } from './types.js';

export interface PotCalculationResult {
  pots: SidePot[];
  refunds: Array<{ seatIndex: number; amount: number }>;
}

export interface AwardResult {
  payouts: Array<{
    seatIndex: number;
    amount: number;
    potIndex: number;
    handDescription?: string;
  }>;
  totalAwarded: number;
}

/**
 * Calculates main pot and side pots from players' total contributions in the hand.
 * Any uncalled bet where only 1 player is eligible is identified as a refund or uncontested pot.
 */
export function calculatePots(seats: Seat[]): PotCalculationResult {
  // Extract all non-zero contributors
  interface Contributor {
    seatIndex: number;
    amount: number;
    isContender: boolean; // true if active or all_in (can win)
  }

  const contributors: Contributor[] = [];
  for (const seat of seats) {
    if (seat.totalInvestedThisHand > 0) {
      contributors.push({
        seatIndex: seat.seatIndex,
        amount: seat.totalInvestedThisHand,
        isContender: seat.status === 'active' || seat.status === 'all_in'
      });
    }
  }

  if (contributors.length === 0) {
    return { pots: [], refunds: [] };
  }

  // Find all distinct positive contribution thresholds
  const thresholds = Array.from(new Set(contributors.map(c => c.amount))).sort((a, b) => a - b);

  const pots: SidePot[] = [];
  const refunds: Array<{ seatIndex: number; amount: number }> = [];

  let previousThreshold = 0;

  for (const threshold of thresholds) {
    const delta = threshold - previousThreshold;
    if (delta <= 0) continue;

    let potAmount = 0;
    const eligibleSeats: number[] = [];

    for (const c of contributors) {
      if (c.amount > previousThreshold) {
        // Player contributed to this slice
        const contributionInSlice = Math.min(delta, c.amount - previousThreshold);
        potAmount += contributionInSlice;
        if (c.isContender) {
          eligibleSeats.push(c.seatIndex);
        }
      }
    }

    const contributorsInSlice = contributors.filter(c => c.amount > previousThreshold);

    if (potAmount > 0) {
      if (contributorsInSlice.length === 1 && eligibleSeats.length === 1) {
        // Only one player contributed to this slice; this is an uncalled bet / refund
        const refundSeat = eligibleSeats[0];
        const existing = refunds.find(r => r.seatIndex === refundSeat);
        if (existing) {
          existing.amount += potAmount;
        } else {
          refunds.push({ seatIndex: refundSeat, amount: potAmount });
        }
      } else if (eligibleSeats.length >= 1) {
        // Contested or multi-contributor pot
        const lastPot = pots.length > 0 ? pots[pots.length - 1] : null;
        if (lastPot && areSeatsEqual(lastPot.eligibleSeats, eligibleSeats)) {
          lastPot.amount += potAmount;
        } else {
          pots.push({
            amount: potAmount,
            eligibleSeats: [...eligibleSeats].sort((a, b) => a - b)
          });
        }
      }
    }

    previousThreshold = threshold;
  }

  return { pots, refunds };
}

function areSeatsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

/**
 * Distributes pots to winners based on hand evaluation scores.
 * Odd chips are given to the first winner clockwise from the dealer button.
 */
export function awardPots(
  pots: SidePot[],
  refunds: Array<{ seatIndex: number; amount: number }>,
  seats: Seat[],
  dealerSeat: number,
  handRankings?: Map<number, HandRankResult>
): AwardResult {
  const payouts: AwardResult['payouts'] = [];
  let totalAwarded = 0;

  // 1. Give refunds back to players
  for (const ref of refunds) {
    if (ref.amount > 0) {
      payouts.push({
        seatIndex: ref.seatIndex,
        amount: ref.amount,
        potIndex: -1,
        handDescription: 'Uncalled bet refund'
      });
      totalAwarded += ref.amount;
    }
  }

  // Helper for clockwise distance from dealer button
  const getClockwiseDistance = (seatIndex: number): number => {
    return (seatIndex - dealerSeat + 6) % 6 || 6;
  };

  // 2. Award each pot
  for (let potIdx = 0; potIdx < pots.length; potIdx++) {
    const pot = pots[potIdx];
    if (pot.amount <= 0) continue;

    const eligible = pot.eligibleSeats.filter(seatIdx => {
      const seat = seats.find(s => s.seatIndex === seatIdx);
      return seat && (seat.status === 'active' || seat.status === 'all_in');
    });

    if (eligible.length === 0) continue;

    if (eligible.length === 1) {
      // Uncontested winner
      const winnerSeat = eligible[0];
      payouts.push({
        seatIndex: winnerSeat,
        amount: pot.amount,
        potIndex: potIdx,
        handDescription: 'Uncontested pot'
      });
      totalAwarded += pot.amount;
      continue;
    }

    // Compare hand evaluations if available
    let potWinners: number[] = [];
    let bestScore = -1;

    for (const seatIdx of eligible) {
      const rank = handRankings?.get(seatIdx);
      const score = rank ? rank.score : 0;
      if (score > bestScore) {
        bestScore = score;
        potWinners = [seatIdx];
      } else if (score === bestScore) {
        potWinners.push(seatIdx);
      }
    }

    // Sort pot winners clockwise from button to fairly distribute odd chips
    potWinners.sort((a, b) => getClockwiseDistance(a) - getClockwiseDistance(b));

    const share = Math.floor(pot.amount / potWinners.length);
    let remainder = pot.amount % potWinners.length;

    for (const winnerSeat of potWinners) {
      let winAmount = share;
      if (remainder > 0) {
        winAmount += 1;
        remainder -= 1;
      }

      const rank = handRankings?.get(winnerSeat);
      payouts.push({
        seatIndex: winnerSeat,
        amount: winAmount,
        potIndex: potIdx,
        handDescription: rank ? rank.description : undefined
      });
      totalAwarded += winAmount;
    }
  }

  return { payouts, totalAwarded };
}
