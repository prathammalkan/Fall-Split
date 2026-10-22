import { describe, it, expect } from 'vitest';
import {
  allocateExpensePayerShares,
  calculatePairBalances,
  simplifyDebts,
  aggregateBalance,
} from './balances';
import type { RawLedgerEntry, SettledEntry } from './balances';

describe('allocateExpensePayerShares', () => {
  const positivePartitions = (total: number, count: number): number[][] => {
    if (count === 1) return [[total]];
    const results: number[][] = [];
    for (let first = 1; first <= total - count + 1; first++) {
      for (const rest of positivePartitions(total - first, count - 1)) {
        results.push([first, ...rest]);
      }
    }
    return results;
  };

  it('allocates multiple equal shares proportionally across ₹60/₹40 payers', () => {
    const result = allocateExpensePayerShares(
      [
        { userId: 'alice', amountPaise: 5000 },
        { userId: 'bob', amountPaise: 5000 },
      ],
      [
        { userId: 'alice', amountPaise: 6000 },
        { userId: 'bob', amountPaise: 4000 },
      ]
    );

    expect(
      result.filter((row) => row.participantUserId === 'alice').map((row) => row.amountPaise)
    ).toEqual([3000, 2000]);
    expect(
      result.filter((row) => row.participantUserId === 'bob').map((row) => row.amountPaise)
    ).toEqual([3000, 2000]);
    expect(
      result
        .filter((row) => row.payerUserId === 'alice')
        .reduce((sum, row) => sum + row.amountPaise, 0)
    ).toBe(6000);
    expect(
      result
        .filter((row) => row.payerUserId === 'bob')
        .reduce((sum, row) => sum + row.amountPaise, 0)
    ).toBe(4000);
    const pairBalances = calculatePairBalances(
      result.map((row) => ({
        payerUserId: row.payerUserId,
        participantUserId: row.participantUserId,
        amountPaise: row.amountPaise,
      })),
      []
    );
    expect(
      pairBalances.find((row) => row.userId === 'alice' && row.otherUserId === 'bob')?.netPaise
    ).toBe(1000);
  });

  it('keeps Bob owing Alice ₹50 on a ₹100 equal split', () => {
    const allocation = allocateExpensePayerShares(
      [
        { userId: 'alice', amountPaise: 5000 },
        { userId: 'bob', amountPaise: 5000 },
      ],
      [{ userId: 'alice', amountPaise: 10000 }]
    );

    const balances = calculatePairBalances(
      allocation.map((row) => ({
        payerUserId: row.payerUserId,
        participantUserId: row.participantUserId,
        amountPaise: row.amountPaise,
      })),
      []
    );
    expect(
      balances.find((row) => row.userId === 'alice' && row.otherUserId === 'bob')?.netPaise
    ).toBe(5000);
  });

  it('conserves both participant shares and payer totals when every cell rounds fractionally', () => {
    const allocation = allocateExpensePayerShares(
      [
        { userId: 'alice', amountPaise: 2 },
        { userId: 'bob', amountPaise: 2 },
        { userId: 'carol', amountPaise: 2 },
      ],
      [
        { userId: 'payer-a', amountPaise: 2 },
        { userId: 'payer-b', amountPaise: 2 },
        { userId: 'payer-c', amountPaise: 2 },
      ]
    );

    for (const userId of ['alice', 'bob', 'carol']) {
      expect(
        allocation
          .filter((row) => row.participantUserId === userId)
          .reduce((sum, row) => sum + row.amountPaise, 0)
      ).toBe(2);
    }
    for (const userId of ['payer-a', 'payer-b', 'payer-c']) {
      expect(
        allocation
          .filter((row) => row.payerUserId === userId)
          .reduce((sum, row) => sum + row.amountPaise, 0)
      ).toBe(2);
    }
  });

  it('keeps every allocated cell within its proportional floor/ceiling for small ledgers', () => {
    for (let total = 1; total <= 7; total++) {
      for (let shareCount = 1; shareCount <= Math.min(3, total); shareCount++) {
        for (let payerCount = 1; payerCount <= Math.min(3, total); payerCount++) {
          for (const shareAmounts of positivePartitions(total, shareCount)) {
            for (const payerAmounts of positivePartitions(total, payerCount)) {
              const allocations = allocateExpensePayerShares(
                shareAmounts.map((amountPaise, index) => ({ userId: `s${index}`, amountPaise })),
                payerAmounts.map((amountPaise, index) => ({ userId: `p${index}`, amountPaise }))
              );

              shareAmounts.forEach((shareAmount, row) => {
                const actual = allocations
                  .filter((allocation) => allocation.participantUserId === `s${row}`)
                  .reduce((sum, allocation) => sum + allocation.amountPaise, 0);
                expect(actual).toBe(shareAmount);
                payerAmounts.forEach((payerAmount, column) => {
                  const cell = allocations.find(
                    (allocation) =>
                      allocation.participantUserId === `s${row}` &&
                      allocation.payerUserId === `p${column}`
                  )!.amountPaise;
                  const numerator = shareAmount * payerAmount;
                  const lower = Math.floor(numerator / total);
                  expect(cell).toBeGreaterThanOrEqual(lower);
                  expect(cell).toBeLessThanOrEqual(Math.ceil(numerator / total));
                });
              });

              payerAmounts.forEach((payerAmount, column) => {
                expect(
                  allocations
                    .filter((allocation) => allocation.payerUserId === `p${column}`)
                    .reduce((sum, allocation) => sum + allocation.amountPaise, 0)
                ).toBe(payerAmount);
              });
            }
          }
        }
      }
    }
  });

  it('rejects invalid shares and duplicate or invalid payers', () => {
    expect(() =>
      allocateExpensePayerShares(
        [{ userId: 'a', amountPaise: -1 }],
        [{ userId: 'b', amountPaise: 1 }]
      )
    ).toThrow();
    expect(() =>
      allocateExpensePayerShares(
        [{ userId: 'a', amountPaise: 2 }],
        [{ userId: 'b', amountPaise: 1 }]
      )
    ).toThrow();
    expect(() =>
      allocateExpensePayerShares(
        [{ userId: 'a', amountPaise: 1 }],
        [
          { userId: 'b', amountPaise: 1 },
          { userId: 'b', amountPaise: 0 },
        ]
      )
    ).toThrow();
  });
});

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

  it('settles the exact ₹25 share of a ₹50 two-person expense', () => {
    const ledger: RawLedgerEntry[] = [
      { payerUserId: 'A', participantUserId: 'A', amountPaise: 2500 },
      { payerUserId: 'A', participantUserId: 'B', amountPaise: 2500 },
    ];
    const settled: SettledEntry[] = [{ payerUserId: 'B', recipientUserId: 'A', amountPaise: 2500 }];

    expect(
      calculatePairBalances(ledger, []).find(
        (balance) => balance.userId === 'A' && balance.otherUserId === 'B'
      )?.netPaise
    ).toBe(2500);
    expect(calculatePairBalances(ledger, settled)).toHaveLength(0);
  });

  it('keeps the unpaid remainder after a partial settlement', () => {
    const ledger: RawLedgerEntry[] = [
      { payerUserId: 'A', participantUserId: 'B', amountPaise: 5000 },
    ];
    const settled: SettledEntry[] = [{ payerUserId: 'B', recipientUserId: 'A', amountPaise: 2500 }];
    const aBalance = calculatePairBalances(ledger, settled).find(
      (balance) => balance.userId === 'A' && balance.otherUserId === 'B'
    );

    expect(aBalance?.netPaise).toBe(2500);
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
