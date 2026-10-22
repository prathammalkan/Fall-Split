import { describe, it, expect } from 'vitest';
import {
  equalSplit,
  unequalSplit,
  percentageSplit,
  sharesSplit,
  itemizedSplit,
  validateMultiplePayers,
} from './splits';

// Helper: verify allocations sum to total
function assertReconciled(
  result: { allocations: { amountPaise: number }[]; reconciled: boolean },
  total: number
) {
  const sum = result.allocations.reduce((acc, a) => acc + a.amountPaise, 0);
  expect(sum).toBe(total);
  expect(result.reconciled).toBe(true);
}

describe('equalSplit', () => {
  it('splits evenly among 2', () => {
    const result = equalSplit(10000, ['a', 'b']);
    assertReconciled(result, 10000);
    expect(result.allocations[0]?.amountPaise).toBe(5000);
    expect(result.allocations[1]?.amountPaise).toBe(5000);
  });

  it('distributes remainder to first participants', () => {
    // 100 paise / 3 = 33.33... → 34, 33, 33
    const result = equalSplit(100, ['a', 'b', 'c']);
    assertReconciled(result, 100);
    expect(result.allocations[0]?.amountPaise).toBe(34);
    expect(result.allocations[1]?.amountPaise).toBe(33);
    expect(result.allocations[2]?.amountPaise).toBe(33);
  });

  it('handles INR example: ₹100 among 3', () => {
    const result = equalSplit(10000, ['a', 'b', 'c']);
    assertReconciled(result, 10000);
    // 10000 / 3 = 3333 rem 1 → first gets 3334
    expect(result.allocations[0]?.amountPaise).toBe(3334);
    expect(result.allocations[1]?.amountPaise).toBe(3333);
    expect(result.allocations[2]?.amountPaise).toBe(3333);
  });

  it('throws for zero total', () => {
    expect(() => equalSplit(0, ['a', 'b'])).toThrow();
  });

  it('throws for no participants', () => {
    expect(() => equalSplit(100, [])).toThrow();
  });

  it('handles single participant', () => {
    const result = equalSplit(10000, ['a']);
    assertReconciled(result, 10000);
    expect(result.allocations[0]?.amountPaise).toBe(10000);
  });

  it('handles 2 paise among 3 participants', () => {
    const result = equalSplit(2, ['a', 'b', 'c']);
    assertReconciled(result, 2);
    // 2/3 = 0 rem 2 → first two get 1, last gets 0
    expect(result.allocations[0]?.amountPaise).toBe(1);
    expect(result.allocations[1]?.amountPaise).toBe(1);
    expect(result.allocations[2]?.amountPaise).toBe(0);
  });
});

describe('unequalSplit', () => {
  it('accepts valid assignments summing to total', () => {
    const result = unequalSplit(10000, [
      { userId: 'a', amountPaise: 6000 },
      { userId: 'b', amountPaise: 4000 },
    ]);
    assertReconciled(result, 10000);
  });

  it('throws when amounts do not sum to total', () => {
    expect(() =>
      unequalSplit(10000, [
        { userId: 'a', amountPaise: 6000 },
        { userId: 'b', amountPaise: 3000 },
      ])
    ).toThrow();
  });

  it('throws for negative amounts', () => {
    expect(() =>
      unequalSplit(10000, [
        { userId: 'a', amountPaise: 11000 },
        { userId: 'b', amountPaise: -1000 },
      ])
    ).toThrow();
  });

  it('throws for empty assignments', () => {
    expect(() => unequalSplit(10000, [])).toThrow();
  });

  it('throws for duplicate participant IDs', () => {
    expect(() =>
      unequalSplit(10000, [
        { userId: 'a', amountPaise: 6000 },
        { userId: 'a', amountPaise: 4000 },
      ])
    ).toThrow();
  });
});

describe('percentageSplit', () => {
  it('splits 50/50', () => {
    const result = percentageSplit(10000, [
      { userId: 'a', percentage: 50 },
      { userId: 'b', percentage: 50 },
    ]);
    assertReconciled(result, 10000);
    expect(result.allocations[0]?.amountPaise).toBe(5000);
    expect(result.allocations[1]?.amountPaise).toBe(5000);
  });

  it('distributes remainder to largest fractional part', () => {
    // 33.33% of 100 paise = 33.33 → floor to 33 each, remainder 1 goes to largest fraction
    const result = percentageSplit(100, [
      { userId: 'a', percentage: 33.33 },
      { userId: 'b', percentage: 33.33 },
      { userId: 'c', percentage: 33.34 },
    ]);
    assertReconciled(result, 100);
  });

  it('throws when percentages do not sum to 100', () => {
    expect(() =>
      percentageSplit(10000, [
        { userId: 'a', percentage: 50 },
        { userId: 'b', percentage: 40 },
      ])
    ).toThrow();
  });

  it('throws for negative percentage', () => {
    expect(() =>
      percentageSplit(10000, [
        { userId: 'a', percentage: 110 },
        { userId: 'b', percentage: -10 },
      ])
    ).toThrow();
  });

  it('throws for non-finite percentages', () => {
    expect(() =>
      percentageSplit(10000, [
        { userId: 'a', percentage: Number.NaN },
        { userId: 'b', percentage: 100 },
      ])
    ).toThrow();
  });

  it('handles 70/30 split', () => {
    const result = percentageSplit(10000, [
      { userId: 'a', percentage: 70 },
      { userId: 'b', percentage: 30 },
    ]);
    assertReconciled(result, 10000);
    expect(result.allocations[0]?.amountPaise).toBe(7000);
    expect(result.allocations[1]?.amountPaise).toBe(3000);
  });
});

describe('sharesSplit', () => {
  it('splits 2:1:1', () => {
    const result = sharesSplit(10000, [
      { userId: 'a', shares: 2 },
      { userId: 'b', shares: 1 },
      { userId: 'c', shares: 1 },
    ]);
    assertReconciled(result, 10000);
    expect(result.allocations[0]?.amountPaise).toBe(5000);
    expect(result.allocations[1]?.amountPaise).toBe(2500);
    expect(result.allocations[2]?.amountPaise).toBe(2500);
  });

  it('handles remainder distribution', () => {
    // 100 paise, shares 1:1:1 = 33.33 each, remainder 1 to first largest fraction
    const result = sharesSplit(100, [
      { userId: 'a', shares: 1 },
      { userId: 'b', shares: 1 },
      { userId: 'c', shares: 1 },
    ]);
    assertReconciled(result, 100);
  });

  it('throws for zero shares', () => {
    expect(() =>
      sharesSplit(10000, [
        { userId: 'a', shares: 0 },
        { userId: 'b', shares: 1 },
      ])
    ).toThrow();
  });

  it('throws for empty assignments', () => {
    expect(() => sharesSplit(10000, [])).toThrow();
  });

  it('handles non-integer share weights', () => {
    const result = sharesSplit(10000, [
      { userId: 'a', shares: 1.5 },
      { userId: 'b', shares: 0.5 },
    ]);
    assertReconciled(result, 10000);
    expect(result.allocations[0]?.amountPaise).toBe(7500);
    expect(result.allocations[1]?.amountPaise).toBe(2500);
  });
});

describe('itemizedSplit', () => {
  it('splits simple items', () => {
    const result = itemizedSplit(10000, [
      {
        name: 'Pizza',
        totalPaise: 6000,
        participants: [
          { userId: 'a', amountPaise: 3000 },
          { userId: 'b', amountPaise: 3000 },
        ],
      },
      {
        name: 'Drinks',
        totalPaise: 4000,
        participants: [
          { userId: 'a', amountPaise: 2000 },
          { userId: 'b', amountPaise: 2000 },
        ],
      },
    ]);
    assertReconciled(result, 10000);
    const aAlloc = result.allocations.find((x) => x.userId === 'a');
    const bAlloc = result.allocations.find((x) => x.userId === 'b');
    expect(aAlloc?.amountPaise).toBe(5000);
    expect(bAlloc?.amountPaise).toBe(5000);
  });

  it('throws when item participant sum != item total', () => {
    expect(() =>
      itemizedSplit(10000, [
        {
          name: 'Pizza',
          totalPaise: 6000,
          participants: [{ userId: 'a', amountPaise: 5000 }],
        },
        {
          name: 'Drinks',
          totalPaise: 4000,
          participants: [{ userId: 'b', amountPaise: 4000 }],
        },
      ])
    ).toThrow();
  });

  it('throws when items total != expense total', () => {
    expect(() =>
      itemizedSplit(10000, [
        {
          name: 'Pizza',
          totalPaise: 8000,
          participants: [{ userId: 'a', amountPaise: 8000 }],
        },
      ])
    ).toThrow();
  });

  it('aggregates per-user allocations across items', () => {
    const result = itemizedSplit(9000, [
      {
        name: 'Item1',
        totalPaise: 5000,
        participants: [{ userId: 'a', amountPaise: 5000 }],
      },
      {
        name: 'Item2',
        totalPaise: 4000,
        participants: [
          { userId: 'a', amountPaise: 2000 },
          { userId: 'b', amountPaise: 2000 },
        ],
      },
    ]);
    assertReconciled(result, 9000);
    const aAlloc = result.allocations.find((x) => x.userId === 'a');
    const bAlloc = result.allocations.find((x) => x.userId === 'b');
    expect(aAlloc?.amountPaise).toBe(7000);
    expect(bAlloc?.amountPaise).toBe(2000);
  });
});

describe('validateMultiplePayers', () => {
  it('passes for valid payers summing to total', () => {
    expect(() =>
      validateMultiplePayers(10000, [
        { userId: 'a', amountPaise: 6000 },
        { userId: 'b', amountPaise: 4000 },
      ])
    ).not.toThrow();
  });

  it('throws when payer sum != total', () => {
    expect(() =>
      validateMultiplePayers(10000, [
        { userId: 'a', amountPaise: 5000 },
        { userId: 'b', amountPaise: 4000 },
      ])
    ).toThrow();
  });

  it('throws for zero amount payer', () => {
    expect(() =>
      validateMultiplePayers(10000, [
        { userId: 'a', amountPaise: 0 },
        { userId: 'b', amountPaise: 10000 },
      ])
    ).toThrow();
  });

  it('throws for empty payers', () => {
    expect(() => validateMultiplePayers(10000, [])).toThrow();
  });
});

describe('safe paise boundaries', () => {
  it('rejects unsafe totals and assignments', () => {
    expect(() => equalSplit(Number.MAX_SAFE_INTEGER + 1, ['a'])).toThrow();
    expect(() =>
      unequalSplit(Number.MAX_SAFE_INTEGER, [
        { userId: 'a', amountPaise: Number.MAX_SAFE_INTEGER },
        { userId: 'b', amountPaise: 1 },
      ])
    ).toThrow();
  });

  it('rejects item totals whose combined amount overflows safe integer precision', () => {
    expect(() =>
      itemizedSplit(Number.MAX_SAFE_INTEGER, [
        {
          name: 'A',
          totalPaise: Number.MAX_SAFE_INTEGER,
          participants: [{ userId: 'a', amountPaise: Number.MAX_SAFE_INTEGER }],
        },
        {
          name: 'B',
          totalPaise: 1,
          participants: [{ userId: 'b', amountPaise: 1 }],
        },
      ])
    ).toThrow();
  });

  it('reconciles percentage and weighted splits at the largest safe paise total', () => {
    const total = Number.MAX_SAFE_INTEGER;
    const percentages = percentageSplit(total, [
      { userId: 'a', percentage: 50 },
      { userId: 'b', percentage: 50 },
    ]);
    const shares = sharesSplit(total, [
      { userId: 'a', shares: 1 },
      { userId: 'b', shares: 1 },
    ]);

    assertReconciled(percentages, total);
    assertReconciled(shares, total);
    expect(percentages.allocations.map((allocation) => allocation.amountPaise)).toEqual([
      4503599627370496, 4503599627370495,
    ]);
    expect(shares.allocations.map((allocation) => allocation.amountPaise)).toEqual([
      4503599627370496, 4503599627370495,
    ]);
  });

  it('conserves totals across deterministic randomized split inputs', () => {
    let seed = 0x5eed1234;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (let sample = 0; sample < 250; sample++) {
      const totalPaise = 1 + Math.floor(random() * 1_000_000_000);
      const participantCount = 1 + Math.floor(random() * 8);
      const ids = Array.from({ length: participantCount }, (_, index) => `u${index}`);
      const weights = ids.map(() => 1 + Math.floor(random() * 100));
      const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
      const percentages = weights.map((weight, index) => ({
        userId: ids[index]!,
        percentage: (weight / weightTotal) * 100,
      }));

      assertReconciled(equalSplit(totalPaise, ids), totalPaise);
      assertReconciled(
        sharesSplit(
          totalPaise,
          weights.map((shares, index) => ({ userId: ids[index]!, shares }))
        ),
        totalPaise
      );
      assertReconciled(percentageSplit(totalPaise, percentages), totalPaise);
    }
  });
});
