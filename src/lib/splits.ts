/**
 * Fall Split — Split calculation engine
 *
 * All amounts in paise (integer). Never uses floating-point for money.
 *
 * Remainder distribution rule (documented):
 * When dividing P paise among N participants, each gets floor(P/N) paise.
 * The remainder (P mod N) is distributed one paise at a time to the first
 * (P mod N) participants in the order they appear in the input array.
 * This is deterministic and ensures sum(allocations) === totalPaise exactly.
 */

import type { SplitResult } from '../types';

/**
 * A. Equal split
 * Divides totalPaise as evenly as possible.
 * Remainder is distributed to the first N participants (deterministic).
 */
export function equalSplit(
  totalPaise: number,
  participantIds: string[]
): SplitResult {
  if (!Number.isInteger(totalPaise) || totalPaise <= 0) {
    throw new Error(`equalSplit: totalPaise must be a positive integer, got ${totalPaise}`);
  }
  if (participantIds.length === 0) {
    throw new Error('equalSplit: at least one participant required');
  }

  const n = participantIds.length;
  const base = Math.floor(totalPaise / n);
  const remainder = totalPaise % n;

  const allocations = participantIds.map((userId, i) => ({
    userId,
    amountPaise: base + (i < remainder ? 1 : 0),
  }));

  // Invariant: sum must equal total
  const sum = allocations.reduce((acc, a) => acc + a.amountPaise, 0);
  if (sum !== totalPaise) {
    throw new Error(`equalSplit: allocation sum ${sum} !== total ${totalPaise}`);
  }

  return { allocations, reconciled: true };
}

/**
 * B. Unequal split
 * Each participant has an explicitly assigned amount.
 * Validates that assignments sum to totalPaise.
 */
export function unequalSplit(
  totalPaise: number,
  assignments: { userId: string; amountPaise: number }[]
): SplitResult {
  if (!Number.isInteger(totalPaise) || totalPaise <= 0) {
    throw new Error('unequalSplit: totalPaise must be a positive integer');
  }
  if (assignments.length === 0) {
    throw new Error('unequalSplit: at least one assignment required');
  }

  for (const a of assignments) {
    if (!Number.isInteger(a.amountPaise) || a.amountPaise < 0) {
      throw new Error(
        `unequalSplit: amountPaise must be a non-negative integer for ${a.userId}, got ${a.amountPaise}`
      );
    }
  }

  const sum = assignments.reduce((acc, a) => acc + a.amountPaise, 0);
  if (sum !== totalPaise) {
    throw new Error(
      `unequalSplit: amounts sum to ${sum} paise but expense total is ${totalPaise} paise`
    );
  }

  return {
    allocations: assignments.map((a) => ({ userId: a.userId, amountPaise: a.amountPaise })),
    reconciled: true,
  };
}

/**
 * C. Percentage split
 * Percentages must sum to exactly 100.
 * Monetary allocations are calculated from percentages.
 * Remainder after rounding is assigned to the largest-percentage participant.
 */
export function percentageSplit(
  totalPaise: number,
  assignments: { userId: string; percentage: number }[]
): SplitResult {
  if (!Number.isInteger(totalPaise) || totalPaise <= 0) {
    throw new Error('percentageSplit: totalPaise must be a positive integer');
  }
  if (assignments.length === 0) {
    throw new Error('percentageSplit: at least one assignment required');
  }

  for (const a of assignments) {
    if (a.percentage < 0 || a.percentage > 100) {
      throw new Error(
        `percentageSplit: invalid percentage ${a.percentage} for ${a.userId}`
      );
    }
  }

  // Validate total percentage — allow tiny float tolerance for display purposes
  const totalPct = assignments.reduce((acc, a) => acc + a.percentage, 0);
  if (Math.abs(totalPct - 100) > 0.0001) {
    throw new Error(
      `percentageSplit: percentages sum to ${totalPct}, must equal 100`
    );
  }

  // Calculate floor allocations
  const allocations = assignments.map((a) => ({
    userId: a.userId,
    percentage: a.percentage,
    amountPaise: Math.floor((a.percentage / 100) * totalPaise),
  }));

  // Distribute remainder deterministically to largest-percentage participant
  const allocated = allocations.reduce((acc, a) => acc + a.amountPaise, 0);
  let remainder = totalPaise - allocated;

  // Sort by fractional part descending, break ties by original order
  const withFraction = allocations.map((a, i) => ({
    i,
    fraction: (a.percentage / 100) * totalPaise - Math.floor((a.percentage / 100) * totalPaise),
  }));
  withFraction.sort((x, y) => y.fraction - x.fraction || x.i - y.i);

  for (let k = 0; k < remainder; k++) {
    const idx = withFraction[k]?.i;
    if (idx !== undefined && allocations[idx]) {
      allocations[idx]!.amountPaise += 1;
    }
  }

  const sum = allocations.reduce((acc, a) => acc + a.amountPaise, 0);
  if (sum !== totalPaise) {
    throw new Error(`percentageSplit: allocation sum ${sum} !== total ${totalPaise}`);
  }

  return {
    allocations: allocations.map(({ userId, amountPaise }) => ({ userId, amountPaise })),
    reconciled: true,
  };
}

/**
 * D. Shares/weights split
 * Participants have relative share weights (e.g. 2:1:1).
 * Proportional amounts calculated, remainder distributed by largest fractional part.
 */
export function sharesSplit(
  totalPaise: number,
  assignments: { userId: string; shares: number }[]
): SplitResult {
  if (!Number.isInteger(totalPaise) || totalPaise <= 0) {
    throw new Error('sharesSplit: totalPaise must be a positive integer');
  }
  if (assignments.length === 0) {
    throw new Error('sharesSplit: at least one assignment required');
  }

  for (const a of assignments) {
    if (a.shares <= 0) {
      throw new Error(`sharesSplit: shares must be positive for ${a.userId}, got ${a.shares}`);
    }
  }

  const totalShares = assignments.reduce((acc, a) => acc + a.shares, 0);
  if (totalShares <= 0) {
    throw new Error('sharesSplit: total shares must be positive');
  }

  // Exact value per share (may be fractional)
  const paisePerShare = totalPaise / totalShares;

  const allocations = assignments.map((a) => ({
    userId: a.userId,
    shares: a.shares,
    exact: a.shares * paisePerShare,
    amountPaise: Math.floor(a.shares * paisePerShare),
  }));

  const allocated = allocations.reduce((acc, a) => acc + a.amountPaise, 0);
  let remainder = totalPaise - allocated;

  // Distribute remainder by largest fractional part
  const withFraction = allocations.map((a, i) => ({
    i,
    fraction: a.exact - Math.floor(a.exact),
  }));
  withFraction.sort((x, y) => y.fraction - x.fraction || x.i - y.i);

  for (let k = 0; k < remainder; k++) {
    const idx = withFraction[k]?.i;
    if (idx !== undefined && allocations[idx]) {
      allocations[idx]!.amountPaise += 1;
    }
  }

  const sum = allocations.reduce((acc, a) => acc + a.amountPaise, 0);
  if (sum !== totalPaise) {
    throw new Error(`sharesSplit: allocation sum ${sum} !== total ${totalPaise}`);
  }

  return {
    allocations: allocations.map(({ userId, amountPaise }) => ({ userId, amountPaise })),
    reconciled: true,
  };
}

/**
 * E. Itemized split
 * Items have their own participant allocations.
 * Each item's participant allocations must reconcile to the item total.
 * All items combined must reconcile to the expense total.
 */
export function itemizedSplit(
  totalPaise: number,
  items: {
    name: string;
    totalPaise: number;
    participants: { userId: string; amountPaise: number }[];
  }[]
): SplitResult {
  if (!Number.isInteger(totalPaise) || totalPaise <= 0) {
    throw new Error('itemizedSplit: totalPaise must be a positive integer');
  }
  if (items.length === 0) {
    throw new Error('itemizedSplit: at least one item required');
  }

  // Validate each item
  for (const item of items) {
    if (!Number.isInteger(item.totalPaise) || item.totalPaise < 0) {
      throw new Error(`itemizedSplit: item "${item.name}" has invalid totalPaise`);
    }
    const itemSum = item.participants.reduce((acc, p) => acc + p.amountPaise, 0);
    if (itemSum !== item.totalPaise) {
      throw new Error(
        `itemizedSplit: item "${item.name}" participant sum ${itemSum} !== item total ${item.totalPaise}`
      );
    }
  }

  // Validate items sum to expense total
  const itemsTotal = items.reduce((acc, item) => acc + item.totalPaise, 0);
  if (itemsTotal !== totalPaise) {
    throw new Error(
      `itemizedSplit: items total ${itemsTotal} !== expense total ${totalPaise}`
    );
  }

  // Aggregate per-user allocations across all items
  const userTotals = new Map<string, number>();
  for (const item of items) {
    for (const p of item.participants) {
      userTotals.set(p.userId, (userTotals.get(p.userId) ?? 0) + p.amountPaise);
    }
  }

  const allocations = Array.from(userTotals.entries()).map(([userId, amountPaise]) => ({
    userId,
    amountPaise,
  }));

  const sum = allocations.reduce((acc, a) => acc + a.amountPaise, 0);
  if (sum !== totalPaise) {
    throw new Error(`itemizedSplit: allocation sum ${sum} !== total ${totalPaise}`);
  }

  return { allocations, reconciled: true };
}

/**
 * Validate multiple payer contributions
 */
export function validateMultiplePayers(
  totalPaise: number,
  payers: { userId: string; amountPaise: number }[]
): void {
  if (payers.length === 0) {
    throw new Error('validateMultiplePayers: at least one payer required');
  }
  for (const p of payers) {
    if (!Number.isInteger(p.amountPaise) || p.amountPaise <= 0) {
      throw new Error(
        `validateMultiplePayers: amountPaise must be a positive integer for ${p.userId}`
      );
    }
  }
  const sum = payers.reduce((acc, p) => acc + p.amountPaise, 0);
  if (sum !== totalPaise) {
    throw new Error(
      `validateMultiplePayers: payer contributions ${sum} !== expense total ${totalPaise}`
    );
  }
}
