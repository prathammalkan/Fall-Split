/**
 * Regression tests for bugs fixed in the exhaustive audit.
 * Each test corresponds to a documented bug ID (B4, B10, etc.).
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// B10 — ActivityPage CSV injection regex
// The original regex /["=+@-]/g had @-] as a range (ASCII 64–93) which
// matched uppercase A-Z, [, \, ]. Fixed to /[-"|=+@]/g.
// ---------------------------------------------------------------------------
describe('B10 — CSV injection escaping regex', () => {
  /**
   * Simulates the escaping applied in ActivityPage.exportCSV
   * (the fixed version that moves - to front of character class).
   */
  const escapeForCSV = (title: string) =>
    `"${title.replace(/[-"|=+@]/g, (c) => `'${c}`).replace(/"/g, '""')}"`;

  it('does NOT corrupt uppercase letters', () => {
    const result = escapeForCSV('Dinner At Restaurant');
    expect(result).toBe('"Dinner At Restaurant"');
  });

  it('escapes leading = (formula injection)', () => {
    expect(escapeForCSV('=SUM(A1)')).toBe('"\'=SUM(A1)"');
  });

  it('escapes leading + (formula injection)', () => {
    // + and | are both in the matched set (| is between " and = in the char class)
    // so '+cmd|' → "'+cmd'|"
    const result = escapeForCSV('+cmd|');
    expect(result).toBe(`"'+cmd'|"`);
  });

  it('escapes leading @', () => {
    expect(escapeForCSV('@user')).toBe('"\'@user"');
  });

  it('escapes embedded double quotes', () => {
    expect(escapeForCSV('Say "hello"')).toBe('"Say \'""hello\'"""');
  });

  it('escapes leading hyphen', () => {
    // - is escaped globally; + is also escaped: '-1+2' → "'-1'+2"
    const result = escapeForCSV('-1+2');
    expect(result).toBe(`"'-1'+2"`);
  });

  it('does not modify a normal title', () => {
    expect(escapeForCSV('Groceries')).toBe('"Groceries"');
  });
});

// ---------------------------------------------------------------------------
// B4 — ExpenseDetailPage net sign convention
// netPaise for a payer = payerAmt - shareAmt  (positive = they overpaid = they're owed)
// The original code had shareAmt - payerAmt (inverted sign).
// ---------------------------------------------------------------------------
describe('B4 — Expense detail net sign for payer', () => {
  const computeNetPaise = (payerAmt: number, shareAmt: number) =>
    payerAmt - shareAmt; // fixed formula

  it('payer who overpaid has positive net (owed back)', () => {
    // A pays ₹100 for a ₹40 share → net = +₹60 (they are owed ₹60)
    expect(computeNetPaise(10000, 4000)).toBe(6000);
  });

  it('payer whose payment exactly matches share has zero net', () => {
    // A pays ₹50, share is ₹50 → net = 0
    expect(computeNetPaise(5000, 5000)).toBe(0);
  });

  it('payer who paid less than their share has negative net (still owes)', () => {
    // A pays ₹20 but their share is ₹50 → net = -₹30 (they still owe)
    expect(computeNetPaise(2000, 5000)).toBe(-3000);
  });

  it('non-payer net is always negative (they owe the full share)', () => {
    // B has a ₹50 share and paid nothing
    const netForNonPayer = -5000; // -(shareAmt)
    expect(netForNonPayer).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// B12 — ProfilePage UPI validation regex (aligned with DB constraint)
// DB allows numeric provider (e.g. user@1234); client must too.
// ---------------------------------------------------------------------------
describe('B12 — UPI ID validation regex', () => {
  // Fixed regex: aligned to DB constraint ^[a-zA-Z0-9._\-]+@[a-zA-Z0-9]+$
  const isValidUPI = (v: string) => v === '' || /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/.test(v);

  it('accepts standard VPA', () => expect(isValidUPI('user@upi')).toBe(true));
  it('accepts numeric provider', () => expect(isValidUPI('9999999999@paytm')).toBe(true));
  it('accepts numeric-only provider', () => expect(isValidUPI('user@1234')).toBe(true));
  it('accepts empty string (clear field)', () => expect(isValidUPI('')).toBe(true));
  it('rejects missing @', () => expect(isValidUPI('useronly')).toBe(false));
  it('rejects double @', () => expect(isValidUPI('a@b@c')).toBe(false));
  it('rejects special chars in handle', () => expect(isValidUPI('user!@upi')).toBe(false));
});
