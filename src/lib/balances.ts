/**
 * Fall Split — Balance calculations
 *
 * Sign convention:
 *   positive net_balance → user is owed money (others owe them)
 *   negative net_balance → user owes money
 *   zero                 → settled
 *
 * Balances are DERIVED from ledger records (expenses + settlements).
 * They are never stored independently to avoid drift.
 */

import type { PairBalance, SimplifiedDebt } from '../types';

export interface RawLedgerEntry {
  payerUserId: string;
  participantUserId: string;
  amountPaise: number;  // what participant owes payer for this expense
  groupId?: string | null;
}

export interface SettledEntry {
  payerUserId: string;    // person who paid
  recipientUserId: string; // person who received
  amountPaise: number;
  groupId?: string | null;
}

/**
 * Calculate pair balances from ledger entries and settlements.
 * Returns a map: "userA:userB" → net paise (positive = userA is owed by userB)
 *
 * This is O(n) and should be called server-side or with pre-fetched data.
 */
export function calculatePairBalances(
  ledgerEntries: RawLedgerEntry[],
  settlements: SettledEntry[],
  groupId?: string | null
): PairBalance[] {
  // Map key: `${min(a,b)}:${max(a,b)}` → net paise from smaller-id perspective
  const pairMap = new Map<string, { userA: string; userB: string; netPaise: number }>();

  function getPairKey(a: string, b: string): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  function getOrCreate(a: string, b: string) {
    const key = getPairKey(a, b);
    if (!pairMap.has(key)) {
      const userA = a < b ? a : b;
      const userB = a < b ? b : a;
      pairMap.set(key, { userA, userB, netPaise: 0 });
    }
    return pairMap.get(key)!;
  }

  // Process ledger entries (expense shares)
  // participant owes payer → payer's balance increases, participant's decreases
  for (const entry of ledgerEntries) {
    if (entry.payerUserId === entry.participantUserId) continue; // skip self
    if (groupId !== undefined && entry.groupId !== groupId) continue;

    const pair = getOrCreate(entry.payerUserId, entry.participantUserId);
    // If payer is userA: payer is owed → positive
    const sign = pair.userA === entry.payerUserId ? 1 : -1;
    pair.netPaise += sign * entry.amountPaise;
  }

  // Process confirmed settlements
  // settlement: payer paid recipient → reduces recipient's debt to payer
  for (const s of settlements) {
    if (s.payerUserId === s.recipientUserId) continue;
    if (groupId !== undefined && s.groupId !== groupId) continue;

    const pair = getOrCreate(s.payerUserId, s.recipientUserId);
    // B (payer/debtor) pays A (recipient/creditor):
    // A was owed → now owed less → netPaise for userA decreases.
    // When userA === recipient: sign = -1 (reduces what userA is owed)
    // When userA === payer:     sign = +1 (reduces what userA owes, i.e. increases their net)
    const sign = pair.userA === s.recipientUserId ? -1 : 1;
    pair.netPaise += sign * s.amountPaise;
  }

  // Convert to PairBalance array from each user's perspective
  const results: PairBalance[] = [];
  for (const [, pair] of pairMap) {
    if (pair.netPaise === 0) continue; // settled pair, omit
    results.push({
      userId: pair.userA,
      otherUserId: pair.userB,
      netPaise: pair.netPaise,  // positive = userA is owed
      groupId,
    });
    results.push({
      userId: pair.userB,
      otherUserId: pair.userA,
      netPaise: -pair.netPaise, // flip sign for userB
      groupId,
    });
  }

  return results;
}

/**
 * Simplify debts to minimize the number of transactions.
 * Uses a greedy algorithm: repeatedly match the largest creditor with the largest debtor.
 *
 * Input: array of { userId, netPaise } — positive = owed, negative = owing
 * Output: minimal list of directed payments
 *
 * Preserves the same net position for every participant.
 * Deterministic: sorts by userId for tie-breaking.
 */
export function simplifyDebts(
  balances: { userId: string; netPaise: number }[]
): SimplifiedDebt[] {
  // Validate: sum of all balances must be zero
  const total = balances.reduce((acc, b) => acc + b.netPaise, 0);
  if (Math.abs(total) > 1) {
    // Allow 1 paise rounding error
    throw new Error(`simplifyDebts: balances don't sum to zero (sum = ${total})`);
  }

  // Separate creditors (positive) and debtors (negative)
  const creditors: { userId: string; amount: number }[] = [];
  const debtors: { userId: string; amount: number }[] = [];

  for (const b of balances) {
    if (b.netPaise > 0) creditors.push({ userId: b.userId, amount: b.netPaise });
    else if (b.netPaise < 0) debtors.push({ userId: b.userId, amount: -b.netPaise });
  }

  // Sort deterministically
  creditors.sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));
  debtors.sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));

  const result: SimplifiedDebt[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci]!;
    const debtor = debtors[di]!;
    const amount = Math.min(creditor.amount, debtor.amount);

    if (amount > 0) {
      result.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amountPaise: amount,
      });
    }

    creditor.amount -= amount;
    debtor.amount -= amount;

    if (creditor.amount === 0) ci++;
    if (debtor.amount === 0) di++;
  }

  return result;
}

/**
 * Calculate a user's aggregate balance from pair balances
 */
export function aggregateBalance(pairBalances: PairBalance[], userId: string): {
  netPaise: number;
  owedToPaise: number;
  owingPaise: number;
} {
  let owedToPaise = 0;
  let owingPaise = 0;

  for (const pb of pairBalances) {
    if (pb.userId !== userId) continue;
    if (pb.netPaise > 0) owedToPaise += pb.netPaise;
    else if (pb.netPaise < 0) owingPaise += -pb.netPaise;
  }

  return {
    netPaise: owedToPaise - owingPaise,
    owedToPaise,
    owingPaise,
  };
}
