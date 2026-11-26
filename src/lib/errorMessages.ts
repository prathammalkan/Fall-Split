/**
 * errorMessages.ts — Safe, user-friendly error mapping & financial URL guards.
 *
 * Prevents raw PostgreSQL/PostgREST schema details or stack fragments from
 * leaking into the UI while preserving actionable user guidance.
 */

const SAFE_BUSINESS_MESSAGES = [
  /cannot delete expense while a related settlement is pending confirmation/i,
  /only the creator can/i,
  /not a member of this group/i,
  /active authenticated account required/i,
  /active group membership required/i,
  /settlement.*exceeds/i,
  /changed since it was opened/i,
  /idempotency key was already used/i,
  /valid dispute reason/i,
  /already.*approved/i,
  /payer contributions/i,
  /participant shares/i,
  /invitation.*invalid|expired|revoked/i,
];

export function toSafeErrorMessage(error: unknown, fallback: string): string {
  const rawMessage =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message ?? '')
      : typeof error === 'string'
        ? error
        : '';

  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code ?? '')
      : '';

  if (/rate limit|too many requests|429/i.test(rawMessage)) {
    return 'Too many requests right now. Please wait a moment and try again.';
  }

  if (/failed to fetch|networkerror|network request failed|load failed/i.test(rawMessage)) {
    return 'Network error. Please check your connection and try again.';
  }

  if (code === '40001') {
    return 'This record changed while you were editing it. Reload and try again.';
  }

  if (code === '42501') {
    return 'You do not have permission to perform this action.';
  }

  for (const pattern of SAFE_BUSINESS_MESSAGES) {
    if (pattern.test(rawMessage)) {
      return rawMessage;
    }
  }

  return fallback;
}

const UPI_ID_REGEX = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/;

export function isValidUpiId(upiId: string | null | undefined): upiId is string {
  return typeof upiId === 'string' && upiId.length <= 50 && UPI_ID_REGEX.test(upiId);
}

/**
 * Construct a sanitized UPI deep-link for peer-to-peer payments.
 * Returns null if the recipient's UPI ID is missing or fails format checks.
 */
export function buildSafeUpiUrl(
  upiId: string | null | undefined,
  amountPaise: number,
  payeeName: string
): string | null {
  if (!isValidUpiId(upiId)) return null;
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) return null;

  // Strip control characters and clamp length before URL encoding
  const cleanName = Array.from(payeeName)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, 40);
  const rupees = (amountPaise / 100).toFixed(2);
  return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(cleanName || 'Friend')}&am=${rupees}&cu=INR`;
}
