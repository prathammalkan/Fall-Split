/**
 * Fall Split — Money utilities
 *
 * All monetary values are stored as INTEGER PAISE (100 paise = 1 INR).
 * Never use floating-point arithmetic for financial calculations.
 *
 * Sign convention:
 *   positive net_balance → user is owed money
 *   negative net_balance → user owes money
 *   zero                 → settled
 */

/** Format paise as an INR string: 10050 → "₹100.50" */
export function formatINR(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new Error(`formatINR: paise must be integer, got ${paise}`);
  }
  const isNegative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const paiseRemainder = abs % 100;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees + paiseRemainder / 100);
  return `${isNegative ? '-' : ''}₹${formatted}`;
}

/** Format paise as compact form: 150000 → "₹1,500" */
export function formatINRCompact(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new Error(`formatINRCompact: paise must be integer, got ${paise}`);
  }
  const isNegative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = abs / 100;
  const prefix = isNegative ? '-' : '';
  if (rupees >= 100000) {
    return `${prefix}₹${(rupees / 100000).toFixed(1)}L`;
  }
  if (rupees >= 1000) {
    return `${prefix}₹${(rupees / 1000).toFixed(1)}K`;
  }
  return `${prefix}${formatINR(abs).replace(/^-/,'')}`;
}

/**
 * Parse a rupee string to paise.
 * Accepts: "100", "100.50", "₹100.50", "1,00,000"
 * Returns null for invalid input.
 */
export function parseINR(value: string): number | null {
  const cleaned = value.replace(/[₹,\s]/g, '').trim();
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const num = parseFloat(cleaned);
  if (isNaN(num) || !isFinite(num)) return null;
  if (num < 0) return null; // amounts cannot be negative in normal flow
  // Convert to paise using integer math to avoid floating point errors
  const parts = cleaned.split('.');
  const rupeeStr = parts[0] ?? '0';
  const paiseStr = (parts[1] ?? '00').padEnd(2, '0').substring(0, 2);
  const rupeePaise = parseInt(rupeeStr, 10) * 100;
  const remainderPaise = parseInt(paiseStr, 10);
  return rupeePaise + remainderPaise;
}

/**
 * Convert rupee decimal to paise (exact integer).
 * Use this when you have a rupee amount as a JS number.
 * WARNING: Only pass values that came from parseFloat of a 2-decimal string.
 */
export function rupeesToPaise(rupees: number): number {
  // Multiply by 100 and round to avoid floating-point imprecision
  return Math.round(rupees * 100);
}

/** Convert paise to rupees as a JS number */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/** Assert that a value is a valid paise integer */
export function assertPaise(value: unknown, name = 'value'): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer paise, got ${JSON.stringify(value)}`);
  }
}

/** Assert signed paise (can be negative for net balances) */
export function assertSignedPaise(value: unknown, name = 'value'): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer paise, got ${JSON.stringify(value)}`);
  }
}
