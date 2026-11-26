import { describe, expect, it } from 'vitest';
import { buildSafeUpiUrl, isValidUpiId, toSafeErrorMessage } from './errorMessages';

describe('errorMessages & financial URL sanitization', () => {
  it('maps database/network codes cleanly without leaking SQL internals', () => {
    expect(
      toSafeErrorMessage(
        { message: 'relation "public.secret_table" violates constraint xyz' },
        'Could not save expense.'
      )
    ).toBe('Could not save expense.');

    expect(toSafeErrorMessage({ code: '40001', message: 'serialization' }, 'Fallback')).toContain(
      'changed while you were editing'
    );
    expect(
      toSafeErrorMessage({ code: '42501', message: 'permission denied' }, 'Fallback')
    ).toContain('permission');
    expect(toSafeErrorMessage({ message: 'Failed to fetch' }, 'Fallback')).toContain(
      'Network error'
    );
    expect(toSafeErrorMessage({ message: '429 rate limit exceeded' }, 'Fallback')).toContain(
      'Too many requests'
    );
  });

  it('preserves explicitly allowlisted business rule messages', () => {
    const msg = 'Cannot delete expense while a related settlement is pending confirmation';
    expect(toSafeErrorMessage({ message: msg }, 'Fallback')).toBe(msg);
  });

  it('validates UPI IDs strictly and constructs sanitized UPI deep links', () => {
    expect(isValidUpiId('alice@okaxis')).toBe(true);
    expect(isValidUpiId('9876543210@paytm')).toBe(true);
    expect(isValidUpiId('javascript:alert(1)')).toBe(false);
    expect(isValidUpiId('bad@upi?am=1')).toBe(false);

    expect(buildSafeUpiUrl('bad@upi?x=1', 5000, 'Alice')).toBeNull();
    expect(buildSafeUpiUrl('alice@okaxis', 0, 'Alice')).toBeNull();
    expect(buildSafeUpiUrl('alice@okaxis', 12345, 'Alice\n\rSmith')).toBe(
      'upi://pay?pa=alice%40okaxis&pn=AliceSmith&am=123.45&cu=INR'
    );
  });
});
