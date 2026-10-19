import { describe, it, expect } from 'vitest';
import { calculatePairBalances, simplifyDebts, aggregateBalance } from './balances';
import type { RawLedgerEntry, SettledEntry } from './balances';

describe('calculatePairBalances', () => {
  it('computes simple A→B balance', () => {
    // A paid ₹100, B owes A ₹50 (equal split)
    const ledger: RawLedgerEntry[] = [
      { payerUserId: 'A', participantUserId: 'A', amountPaise: 5000 },
      { payerUserId: 'A', participantUserId: 'B', amountPaise: 5000 },
    ];
    const results = calculatePairBalances(ledger, []);
    const bPerspective = results.find((r) => r.userId === 'B' && r.otherUserId === 'A');
    expect(bPerspective?.netPaise).toBe(-5000); // B owes A
    const aPerspective = results.find((r) => r.userId === 'A' && r.otherUserId === 'B');
    expect(aPerspective?.netPaise).toBe(5000); // A is owed by B
  });

  it('nets multiple expenses between same pair', () => {
    const ledger: RawLedgerEntry[] = [
      { payerUserId: 'A', participantUserId: 'B', amountPaise: 5000 },
      { payerUserId: 'B', participantUserId: 'A', amountPaise: 3000 },
    ];
    const results = calculatePairBalances(ledger, []);
    const aPerspective = results.find((r) => r.userId === 'A' && r.otherUserId === 'B');
    // A is owed 5000 by B, A owes 3000 to B → net A is owed 2000
    expect(aPerspective?.netPaise).toBe(2000);
  });

  it('skips self-payments', () => {
    const ledger: RawLedgerEntry[] = [
      { payerUserId: 'A', participantUserId: 'A', amountPaise: 5000 },
    ];
    const results = calculatePairBalances(ledger, []);
    expect(results.length).toBe(0);
  });

  it('applies confirmed settlements', () => {
    const ledger: RawLedgerEntry[] = [
      { payerUserId: 'A', participantUserId: 'B', amountPaise: 5000 },
    ];
    const settlements: SettledEntry[] = [
      { payerUserId: 'B', recipientUserId: 'A', amountPaise: 5000 },
    ];
    const results = calculatePairBalances(ledger, settlements);
    // After settlement, they're even → results should be empty (filtered 0)
    const aPerspective = results.find((r) => r.userId === 'A');
    expect(aPerspective).toBeUndefined();
  });

  it('filters by groupId', () => {
    const ledger: RawLedgerEntry[] = [
      { payerUserId: 'A', participantUserId: 'B', amountPaise: 5000, groupId: 'g1' },
      { payerUserId: 'A', participantUserId: 'B', amountPaise: 3000, groupId: 'g2' },
    ];
    const resultsG1 = calculatePairBalances(ledger, [], 'g1');
    const aPerspective = resultsG1.find((r) => r.userId === 'A' && r.otherUserId === 'B');
    expect(aPerspective?.netPaise).toBe(5000);
  });
});

describe('simplifyDebts', () => {
  it('returns empty for all-zero balances', () => {
    const result = simplifyDebts([
      { userId: 'A', netPaise: 0 },
      { userId: 'B', netPaise: 0 },
    ]);
    expect(result).toHaveLength(0);
  });

  it('handles simple A owes B', () => {
    const result = simplifyDebts([
      { userId: 'A', netPaise: -5000 },
      { userId: 'B', netPaise: 5000 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.fromUserId).toBe('A');
    expect(result[0]?.toUserId).toBe('B');
    expect(result[0]?.amountPaise).toBe(5000);
  });

  it('minimizes transactions: 3 people circular debt', () => {
    // A owes B 3000, B owes C 3000, C owes A 3000 → all zero net, no transactions
    const result = simplifyDebts([
      { userId: 'A', netPaise: 0 },
      { userId: 'B', netPaise: 0 },
      { userId: 'C', netPaise: 0 },
    ]);
    expect(result).toHaveLength(0);
  });

  it('minimizes transactions: A owes B and C', () => {
    const result = simplifyDebts([
      { userId: 'A', netPaise: -8000 },
      { userId: 'B', netPaise: 5000 },
      { userId: 'C', netPaise: 3000 },
    ]);
    // Should produce at most 2 transactions (A→B and A→C)
    expect(result.length).toBeLessThanOrEqual(2);
    const totalPaid = result.reduce((acc, d) => acc + d.amountPaise, 0);
    expect(totalPaid).toBe(8000);
  });

  it('throws if balances do not sum to zero', () => {
    expect(() =>
      simplifyDebts([
        { userId: 'A', netPaise: -5000 },
        { userId: 'B', netPaise: 6000 }, // sum = 1000 ≠ 0
      ])
    ).toThrow();
  });

  it('preserves net positions', () => {
    const balances = [
      { userId: 'A', netPaise: -9000 },
      { userId: 'B', netPaise: 4000 },
      { userId: 'C', netPaise: 5000 },
    ];
    const debts = simplifyDebts(balances);
    // Verify each user's net from the simplified debts matches original
    const netFromDebts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const d of debts) {
      netFromDebts[d.fromUserId]! -= d.amountPaise;
      netFromDebts[d.toUserId]! += d.amountPaise;
    }
    expect(netFromDebts['A']).toBe(-9000);
    expect(netFromDebts['B']).toBe(4000);
    expect(netFromDebts['C']).toBe(5000);
  });
});

describe('aggregateBalance', () => {
  it('calculates user totals from pair balances', () => {
    const pairBalances = [
      { userId: 'A', otherUserId: 'B', netPaise: 5000 },
      { userId: 'A', otherUserId: 'C', netPaise: -3000 },
      { userId: 'B', otherUserId: 'A', netPaise: -5000 },
      { userId: 'C', otherUserId: 'A', netPaise: 3000 },
    ];
    const result = aggregateBalance(pairBalances, 'A');
    expect(result.owedToPaise).toBe(5000);
    expect(result.owingPaise).toBe(3000);
    expect(result.netPaise).toBe(2000);
  });

  it('returns zeros for unknown user', () => {
    const result = aggregateBalance([], 'Z');
    expect(result.netPaise).toBe(0);
    expect(result.owedToPaise).toBe(0);
    expect(result.owingPaise).toBe(0);
  });
});
