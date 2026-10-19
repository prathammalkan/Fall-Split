# Fall Split — Testing Guide

## Test Stack

- **Vitest** — Unit test runner (compatible with Jest API)
- **fake-indexeddb** — In-memory IndexedDB for offline queue tests
- **@testing-library/react** (available) — For component tests if needed

## Running Tests

```bash
# Run all tests once
npm test

# Run with verbose output
npm test -- --reporter=verbose

# Watch mode (re-runs on file save)
npm run test:watch

# With coverage
npm run test:coverage
```

## Test Files

| File | What it tests |
|---|---|
| `src/lib/money.test.ts` | `formatINR`, `parseINR`, `rupeesToPaise`, assertions |
| `src/lib/splits.test.ts` | All 6 split methods + reconciliation invariants |
| `src/lib/balances.test.ts` | Pair balances, debt simplification, settlement sign convention |

## Financial Correctness Tests

The most critical tests cover financial calculations:

### Split reconciliation

Every split method is tested to ensure `SUM(allocations) === totalPaise` exactly:

```typescript
// ₹100 among 3 people = 3334 + 3333 + 3333 paise
const result = equalSplit(10000, ['a', 'b', 'c']);
expect(result.allocations[0].amountPaise).toBe(3334);
expect(result.allocations[1].amountPaise).toBe(3333);
expect(result.allocations[2].amountPaise).toBe(3333);
// Sum: 3334 + 3333 + 3333 = 10000 ✓
```

### Remainder distribution rule

When `totalPaise % n !== 0`, the remainder (1 paise at a time) goes to the first participants in input order for equal split, and to the largest fractional-part participants for percentage/shares split.

### Settlement sign convention

Sign convention: **positive netPaise = user is owed money, negative = user owes money**.

When B (debtor) pays A (creditor):
- A's netPaise decreases (A is owed less)
- B's netPaise increases (B owes less)

This is verified in `balances.test.ts`.

### Debt simplification

The `simplifyDebts` function preserves net positions:

```typescript
// Before simplification: A owes 9000, B is owed 4000, C is owed 5000
// After simplification: same net positions, ≤ 2 transactions
const debts = simplifyDebts(balances);
const netFromDebts = computeNets(debts);
expect(netFromDebts['A']).toBe(-9000);
expect(netFromDebts['B']).toBe(4000);
expect(netFromDebts['C']).toBe(5000);
```

## Adding New Tests

1. Create a `.test.ts` or `.test.tsx` file next to the module.
2. Import from `vitest`: `import { describe, it, expect } from 'vitest'`.
3. Run `npm test` to verify.

## CI

Tests run automatically on every push and PR via GitHub Actions (`.github/workflows/ci.yml`).

## Test Configuration

See `vitest.config.ts`. Key settings:
- `environment: 'jsdom'` — Simulates browser APIs
- `setupFiles: ['./src/test/setup.ts']` — Installs `fake-indexeddb`
- `globals: true` — No need to import `describe`/`it`/`expect` explicitly (though explicit is preferred)
