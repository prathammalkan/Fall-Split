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
  amountPaise: number; // what participant owes payer for this expense
  groupId?: string | null;
}

export interface SettledEntry {
  payerUserId: string; // person who paid
  recipientUserId: string; // person who received
  amountPaise: number;
  groupId?: string | null;
}

export function allocateExpensePayerShares(
  shares: { userId: string; amountPaise: number }[],
  payers: { userId: string; amountPaise: number }[]
): { payerUserId: string; participantUserId: string; amountPaise: number }[] {
  const validateUniqueAmounts = (
    entries: { userId: string; amountPaise: number }[],
    label: string
  ) => {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (ids.has(entry.userId)) throw new Error(`${label} IDs must be unique`);
      ids.add(entry.userId);
      if (!Number.isSafeInteger(entry.amountPaise) || entry.amountPaise < 0) {
        throw new Error(`${label} amounts must be non-negative safe integers`);
      }
    }
  };

  validateUniqueAmounts(shares, 'Participant');
  validateUniqueAmounts(payers, 'Payer');
  if (shares.length === 0 || payers.length === 0) {
    throw new Error('An expense requires at least one participant and payer');
  }

  const totalShare = shares.reduce((sum, item) => sum + BigInt(item.amountPaise), 0n);
  const totalPaid = payers.reduce((sum, item) => sum + BigInt(item.amountPaise), 0n);
  if (totalShare <= 0n || totalShare !== totalPaid) {
    throw new Error('Payer totals must equal participant shares');
  }

  const orderedShares = [...shares].sort((a, b) =>
    a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
  );
  const orderedPayers = [...payers].sort((a, b) =>
    a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
  );
  const shareCount = orderedShares.length;
  const payerCount = orderedPayers.length;
  const base = Array.from({ length: shareCount }, () => Array<bigint>(payerCount).fill(0n));
  const remainders = Array.from({ length: shareCount }, () => Array<bigint>(payerCount).fill(0n));
  const selected = Array.from({ length: shareCount }, () => Array<boolean>(payerCount).fill(false));
  const rowNeeds = Array<number>(shareCount).fill(0);
  const columnNeeds = Array<number>(payerCount).fill(0);
  for (let row = 0; row < shareCount; row++) {
    let rowBase = 0n;
    for (let column = 0; column < payerCount; column++) {
      const numerator =
        BigInt(orderedShares[row]!.amountPaise) * BigInt(orderedPayers[column]!.amountPaise);
      base[row]![column] = numerator / totalPaid;
      remainders[row]![column] = numerator % totalPaid;
      rowBase += base[row]![column]!;
    }
    rowNeeds[row] = Number(BigInt(orderedShares[row]!.amountPaise) - rowBase);
  }

  for (let column = 0; column < payerCount; column++) {
    const columnBase = base.reduce((sum, row) => sum + row[column]!, 0n);
    columnNeeds[column] = Number(BigInt(orderedPayers[column]!.amountPaise) - columnBase);
  }

  for (let startRow = 0; startRow < shareCount; startRow++) {
    while (rowNeeds[startRow]! > 0) {
      const nodeCount = shareCount + payerCount;
      const parent = Array<number>(nodeCount).fill(-1);
      const queue = [startRow];
      parent[startRow] = startRow;
      let head = 0;
      let endpoint = -1;

      while (head < queue.length && endpoint === -1) {
        const node = queue[head++]!;
        if (node < shareCount) {
          const candidateColumns = Array.from({ length: payerCount }, (_, index) => index)
            .filter((column) => remainders[node]![column]! > 0n && !selected[node]![column])
            .sort((a, b) => {
              const left = remainders[node]![a]!;
              const right = remainders[node]![b]!;
              if (left !== right) return left > right ? -1 : 1;
              const leftId = orderedPayers[a]!.userId;
              const rightId = orderedPayers[b]!.userId;
              return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
            });
          for (const column of candidateColumns) {
            const columnNode = shareCount + column;
            if (parent[columnNode] !== -1) continue;
            parent[columnNode] = node;
            queue.push(columnNode);
            if (columnNeeds[column]! > 0) {
              endpoint = columnNode;
              break;
            }
          }
        } else {
          const column = node - shareCount;
          for (let row = 0; row < shareCount; row++) {
            if (!selected[row]![column] || parent[row] !== -1) continue;
            parent[row] = node;
            queue.push(row);
          }
        }
      }

      if (endpoint === -1) throw new Error('Could not reconcile integer-paise expense allocation');

      let columnNode = endpoint;
      while (true) {
        const rowNode = parent[columnNode]!;
        const column = columnNode - shareCount;
        selected[rowNode]![column] = true;
        if (rowNode === startRow) break;
        const previousColumnNode = parent[rowNode]!;
        selected[rowNode]![previousColumnNode - shareCount] = false;
        columnNode = previousColumnNode;
      }

      rowNeeds[startRow] = rowNeeds[startRow]! - 1;
      const endpointColumn = endpoint - shareCount;
      columnNeeds[endpointColumn] = columnNeeds[endpointColumn]! - 1;
    }
  }

  if (columnNeeds.some((amount) => amount !== 0)) {
    throw new Error('Could not reconcile payer totals to participant shares');
  }

  return orderedShares.flatMap((share, row) =>
    orderedPayers.map((payer, column) => ({
      payerUserId: payer.userId,
      participantUserId: share.userId,
      amountPaise: Number(base[row]![column]! + (selected[row]![column] ? 1n : 0n)),
    }))
  );
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
      netPaise: pair.netPaise, // positive = userA is owed
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
export function simplifyDebts(balances: { userId: string; netPaise: number }[]): SimplifiedDebt[] {
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
export function aggregateBalance(
  pairBalances: PairBalance[],
  userId: string
): {
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
