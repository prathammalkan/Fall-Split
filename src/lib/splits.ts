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
import Decimal from 'decimal.js';

const CalculationDecimal = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_FLOOR });

function isSafePaise(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function sumSafePaise<T>(values: T[], getAmount: (value: T) => number, operation: string): number {
  let sum = 0;
  for (const value of values) {
    sum += getAmount(value);
    if (!Number.isSafeInteger(sum)) {
      throw new Error(`${operation}: sum exceeds the safe integer paise range`);
    }
  }
  return sum;
}

function allocateProportionally<T>(
  totalPaise: number,
  assignments: T[],
  getWeight: (assignment: T) => number,
  operation: string
): number[] {
  const weights = assignments.map(
    (assignment) => new CalculationDecimal(getWeight(assignment).toString())
  );
  const totalWeight = weights.reduce((sum, weight) => sum.plus(weight), new CalculationDecimal(0));
  if (!totalWeight.isFinite() || totalWeight.lte(0)) {
    throw new Error(`${operation}: total weight must be positive and finite`);
  }

  const total = new CalculationDecimal(totalPaise);
  const bases = weights.map((weight) => total.times(weight).dividedToIntegerBy(totalWeight));
  const remainders = weights.map((weight) => total.times(weight).mod(totalWeight));
  const amounts = bases.map((amount) => amount.toNumber());
  const remainder = totalPaise - sumSafePaise(amounts, (amount) => amount, operation);
  const order = remainders
    .map((fraction, index) => ({ index, fraction }))
    .sort((left, right) => right.fraction.comparedTo(left.fraction) || left.index - right.index);

  if (!Number.isSafeInteger(remainder) || remainder < 0 || remainder > assignments.length) {
    throw new Error(`${operation}: remainder could not be reconciled safely`);
  }
  for (let index = 0; index < remainder; index++) {
    const allocationIndex = order[index]?.index;
    if (allocationIndex === undefined)
      throw new Error(`${operation}: missing remainder allocation target`);
    amounts[allocationIndex] = amounts[allocationIndex]! + 1;
  }
  if (sumSafePaise(amounts, (amount) => amount, operation) !== totalPaise) {
    throw new Error(`${operation}: allocation did not reconcile to expense total`);
  }
  return amounts;
}

/**
 * A. Equal split
 * Divides totalPaise as evenly as possible.
 * Remainder is distributed to the first N participants (deterministic).
 */
export function equalSplit(totalPaise: number, participantIds: string[]): SplitResult {
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
    throw new Error(`equalSplit: totalPaise must be a positive integer, got ${totalPaise}`);
  }
  if (participantIds.length === 0) {
    throw new Error('equalSplit: at least one participant required');
  }

  const seen = new Set<string>();
  for (const userId of participantIds) {
    if (typeof userId !== 'string' || userId.trim() === '' || seen.has(userId)) {
      throw new Error('equalSplit: participantIds must be unique, non-empty strings');
    }
    seen.add(userId);
  }

  const n = participantIds.length;
  const base = Math.floor(totalPaise / n);
  const remainder = totalPaise % n;

  const allocations = participantIds.map((userId, i) => ({
    userId,
    amountPaise: base + (i < remainder ? 1 : 0),
  }));

  // Invariant: sum must equal total
  const sum = sumSafePaise(allocations, (a) => a.amountPaise, 'equalSplit');
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
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
    throw new Error('unequalSplit: totalPaise must be a positive integer');
  }
  if (assignments.length === 0) {
    throw new Error('unequalSplit: at least one assignment required');
  }

  const seen = new Set<string>();
  for (const a of assignments) {
    if (typeof a.userId !== 'string' || a.userId.trim() === '' || seen.has(a.userId)) {
      throw new Error('unequalSplit: userId must be unique and non-empty');
    }
    seen.add(a.userId);
    if (!isSafePaise(a.amountPaise)) {
      throw new Error(
        `unequalSplit: amountPaise must be a non-negative integer for ${a.userId}, got ${a.amountPaise}`
      );
    }
  }

  const sum = sumSafePaise(assignments, (a) => a.amountPaise, 'unequalSplit');
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
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
    throw new Error('percentageSplit: totalPaise must be a positive integer');
  }
  if (assignments.length === 0) {
    throw new Error('percentageSplit: at least one assignment required');
  }

  const seen = new Set<string>();
  for (const a of assignments) {
    if (typeof a.userId !== 'string' || a.userId.trim() === '' || seen.has(a.userId)) {
      throw new Error('percentageSplit: userId must be unique and non-empty');
    }
    seen.add(a.userId);
    if (!Number.isFinite(a.percentage) || a.percentage < 0 || a.percentage > 100) {
      throw new Error(`percentageSplit: invalid percentage ${a.percentage} for ${a.userId}`);
    }
  }

  // Allow only a tiny tolerance for values rounded by the percentage input UI.
  const totalPct = assignments.reduce(
    (acc, assignment) => acc.plus(assignment.percentage.toString()),
    new CalculationDecimal(0)
  );
  if (totalPct.minus(100).abs().gt('0.0001')) {
    throw new Error(`percentageSplit: percentages sum to ${totalPct.toString()}, must equal 100`);
  }

  const amounts = allocateProportionally(
    totalPaise,
    assignments,
    (a) => a.percentage,
    'percentageSplit'
  );

  return {
    allocations: assignments.map((assignment, index) => ({
      userId: assignment.userId,
      amountPaise: amounts[index]!,
    })),
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
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
    throw new Error('sharesSplit: totalPaise must be a positive integer');
  }
  if (assignments.length === 0) {
    throw new Error('sharesSplit: at least one assignment required');
  }

  const seen = new Set<string>();
  for (const a of assignments) {
    if (typeof a.userId !== 'string' || a.userId.trim() === '' || seen.has(a.userId)) {
      throw new Error('sharesSplit: userId must be unique and non-empty');
    }
    seen.add(a.userId);
    if (!Number.isFinite(a.shares) || a.shares <= 0) {
      throw new Error(
        `sharesSplit: shares must be a positive finite number for ${a.userId}, got ${a.shares}`
      );
    }
  }

  const amounts = allocateProportionally(totalPaise, assignments, (a) => a.shares, 'sharesSplit');

  return {
    allocations: assignments.map((assignment, index) => ({
      userId: assignment.userId,
      amountPaise: amounts[index]!,
    })),
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
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
    throw new Error('itemizedSplit: totalPaise must be a positive integer');
  }
  if (items.length === 0) {
    throw new Error('itemizedSplit: at least one item required');
  }

  // Validate each item
  for (const item of items) {
    if (!isSafePaise(item.totalPaise)) {
      throw new Error(`itemizedSplit: item "${item.name}" has invalid totalPaise`);
    }
    if (item.participants.length === 0) {
      throw new Error(`itemizedSplit: item "${item.name}" requires at least one participant`);
    }

    const seen = new Set<string>();
    for (const p of item.participants) {
      if (typeof p.userId !== 'string' || p.userId.trim() === '' || seen.has(p.userId)) {
        throw new Error(`itemizedSplit: item "${item.name}" has duplicate or invalid userId`);
      }
      seen.add(p.userId);
      if (!isSafePaise(p.amountPaise)) {
        throw new Error(
          `itemizedSplit: item "${item.name}" has invalid amountPaise for ${p.userId}`
        );
      }
    }

    const itemSum = sumSafePaise(item.participants, (p) => p.amountPaise, 'itemizedSplit');
    if (itemSum !== item.totalPaise) {
      throw new Error(
        `itemizedSplit: item "${item.name}" participant sum ${itemSum} !== item total ${item.totalPaise}`
      );
    }
  }

  // Validate items sum to expense total
  const itemsTotal = sumSafePaise(items, (item) => item.totalPaise, 'itemizedSplit');
  if (itemsTotal !== totalPaise) {
    throw new Error(`itemizedSplit: items total ${itemsTotal} !== expense total ${totalPaise}`);
  }

  // Aggregate per-user allocations across all items
  const userTotals = new Map<string, number>();
  for (const item of items) {
    for (const p of item.participants) {
      const userTotal = (userTotals.get(p.userId) ?? 0) + p.amountPaise;
      if (!Number.isSafeInteger(userTotal)) {
        throw new Error(
          `itemizedSplit: aggregate for ${p.userId} exceeds the safe integer paise range`
        );
      }
      userTotals.set(p.userId, userTotal);
    }
  }

  const allocations = Array.from(userTotals.entries()).map(([userId, amountPaise]) => ({
    userId,
    amountPaise,
  }));

  const sum = sumSafePaise(allocations, (a) => a.amountPaise, 'itemizedSplit');
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
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
    throw new Error('validateMultiplePayers: totalPaise must be a positive integer');
  }
  if (payers.length === 0) {
    throw new Error('validateMultiplePayers: at least one payer required');
  }
  const seen = new Set<string>();
  for (const p of payers) {
    if (typeof p.userId !== 'string' || p.userId.trim() === '' || seen.has(p.userId)) {
      throw new Error('validateMultiplePayers: userId must be unique and non-empty');
    }
    seen.add(p.userId);
    if (!Number.isSafeInteger(p.amountPaise) || p.amountPaise <= 0) {
      throw new Error(
        `validateMultiplePayers: amountPaise must be a positive integer for ${p.userId}`
      );
    }
  }
  const sum = sumSafePaise(payers, (p) => p.amountPaise, 'validateMultiplePayers');
  if (sum !== totalPaise) {
    throw new Error(
      `validateMultiplePayers: payer contributions ${sum} !== expense total ${totalPaise}`
    );
  }
}
