import { describe, it, expect } from 'vitest';
import { formatINR, formatINRCompact, parseINR, rupeesToPaise, paiseToRupees, assertPaise, assertSignedPaise } from './money';

describe('formatINR', () => {
  it('formats zero', () => {
    expect(formatINR(0)).toBe('₹0.00');
  });

  it('formats whole rupees', () => {
    expect(formatINR(10000)).toBe('₹100.00');
  });

  it('formats paise', () => {
    expect(formatINR(10050)).toBe('₹100.50');
  });

  it('formats negative paise', () => {
    expect(formatINR(-10050)).toBe('-₹100.50');
  });

  it('formats 1 paise', () => {
    expect(formatINR(1)).toBe('₹0.01');
  });

  it('throws on non-integer', () => {
    expect(() => formatINR(10.5)).toThrow();
  });

  it('formats large amounts with Indian number grouping', () => {
    const result = formatINR(10000000); // 1 lakh rupees = 1,00,000 in Indian format
    expect(result).toContain('₹');
    expect(result).toContain('1,00,000');
  });
});

describe('formatINRCompact', () => {
  it('formats regular amounts normally', () => {
    expect(formatINRCompact(10000)).toBe('₹100.00');
  });

  it('formats thousands with K', () => {
    const result = formatINRCompact(200000); // ₹2000
    expect(result).toBe('₹2.0K');
  });

  it('formats lakhs with L', () => {
    const result = formatINRCompact(10000000); // ₹1,00,000
    expect(result).toBe('₹1.0L');
  });

  it('keeps the sign for negative values', () => {
    expect(formatINRCompact(-200000)).toBe('-₹2.0K');
    expect(formatINRCompact(-10000000)).toBe('-₹1.0L');
  });
});

describe('parseINR', () => {
  it('parses integer string', () => {
    expect(parseINR('100')).toBe(10000);
  });

  it('parses decimal string', () => {
    expect(parseINR('100.50')).toBe(10050);
  });

  it('parses with rupee symbol', () => {
    expect(parseINR('₹100.50')).toBe(10050);
  });

  it('parses with commas', () => {
    expect(parseINR('1,00,000')).toBe(10000000);
  });

  it('returns null for empty string', () => {
    expect(parseINR('')).toBeNull();
  });

  it('returns null for non-numeric', () => {
    expect(parseINR('abc')).toBeNull();
  });

  it('returns null for negative', () => {
    expect(parseINR('-100')).toBeNull();
  });

  it('parses 1 paise correctly', () => {
    expect(parseINR('0.01')).toBe(1);
  });

  it('handles single decimal', () => {
    expect(parseINR('10.5')).toBe(1050);
  });

  it('returns null for three decimal places', () => {
    expect(parseINR('10.123')).toBeNull();
  });
});

describe('rupeesToPaise', () => {
  it('converts whole rupees', () => {
    expect(rupeesToPaise(100)).toBe(10000);
  });

  it('converts with paise', () => {
    expect(rupeesToPaise(100.5)).toBe(10050);
  });

  it('rounds correctly to avoid floating point', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
  });
});

describe('paiseToRupees', () => {
  it('converts paise to rupees', () => {
    expect(paiseToRupees(10050)).toBe(100.5);
  });
});

describe('assertPaise', () => {
  it('passes for valid non-negative integers', () => {
    expect(() => assertPaise(0)).not.toThrow();
    expect(() => assertPaise(100)).not.toThrow();
  });

  it('throws for negative', () => {
    expect(() => assertPaise(-1)).toThrow();
  });

  it('throws for float', () => {
    expect(() => assertPaise(1.5)).toThrow();
  });

  it('throws for string', () => {
    expect(() => assertPaise('100')).toThrow();
  });
});

describe('assertSignedPaise', () => {
  it('passes for negative integers', () => {
    expect(() => assertSignedPaise(-100)).not.toThrow();
  });

  it('throws for float', () => {
    expect(() => assertSignedPaise(1.5)).toThrow();
  });
});
