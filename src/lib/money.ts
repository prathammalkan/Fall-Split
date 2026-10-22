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
  if (!Number.isSafeInteger(paise)) {
    throw new Error(`formatINR: paise must be a safe integer, got ${paise}`);
  }
  const isNegative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const paiseRemainder = abs % 100;
  const formattedRupees = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 0,
  }).format(rupees);
  const formattedPaise = String(paiseRemainder).padStart(2, '0');
  return `${isNegative ? '-' : ''}₹${formattedRupees}.${formattedPaise}`;
}

/** Format paise as compact form: 150000 → "₹1,500" */
export function formatINRCompact(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new Error(`formatINRCompact: paise must be a safe integer, got ${paise}`);
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
  return `${prefix}${formatINR(abs).replace(/^-/, '')}`;
}

/**
 * Parse a rupee string to paise.
 * Accepts: "100", "100.50", "₹100.50", "1,00,000"
 * Returns null for invalid input.
 */
export function parseINR(value: string): number | null {
  if (typeof value !== 'string') return null;
  const rupeeSymbolIndex = value.indexOf('₹');
  if (rupeeSymbolIndex > 0 || value.indexOf('₹', rupeeSymbolIndex + 1) !== -1) return null;
  const normalized = value.replace(/[₹\s]/g, '').trim();
  const hasCommas = normalized.includes(',');
  const validGroupedAmount =
    /^-?(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{0,2})?$/.test(normalized);
  if (hasCommas ? !validGroupedAmount : !/^-?\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const cleaned = normalized.replace(/,/g, '');
  if (cleaned.startsWith('-')) return null; // amounts cannot be negative in normal flow
  // Convert to paise using integer math to avoid floating point errors
  const parts = cleaned.split('.');
  const rupeeStr = parts[0] ?? '0';
  const significantRupees = rupeeStr.replace(/^0+(?=\d)/, '');
  if (significantRupees.length > 14) return null;
  const paiseStr = (parts[1] ?? '00').padEnd(2, '0').substring(0, 2);
  try {
    const totalPaise = BigInt(significantRupees) * 100n + BigInt(paiseStr);
    if (totalPaise > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(totalPaise);
  } catch {
    return null;
  }
}

/**
 * Convert rupee decimal to paise (exact integer).
 * Use this when you have a rupee amount as a JS number.
 * WARNING: Only pass values that came from parseFloat of a 2-decimal string.
 */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees) || rupees < 0) {
    throw new Error('rupeesToPaise: rupees must be a finite non-negative number');
  }
  const paise = Math.round(rupees * 100);
  if (!Number.isSafeInteger(paise)) {
    throw new Error('rupeesToPaise: amount exceeds the safe integer paise range');
  }
  return paise;
}

/** Convert paise to rupees as a JS number */
export function paiseToRupees(paise: number): number {
  assertSignedPaise(paise);
  return paise / 100;
}

/** Assert that a value is a valid paise integer */
export function assertPaise(value: unknown, name = 'value'): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `${name} must be a non-negative safe integer paise, got ${JSON.stringify(value)}`
    );
  }
}

/** Assert signed paise (can be negative for net balances) */
export function assertSignedPaise(value: unknown, name = 'value'): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer paise, got ${JSON.stringify(value)}`);
  }
}
