/**
 * rateLimiter.ts — On-device sliding-window & cooldown rate limiter.
 *
 * Enforces client-side burst protection and cooldowns before issuing requests
 * to Supabase Auth or PostgREST, minimizing unnecessary server-side load and
 * protecting against accidental rapid-tap loops or search floods.
 *
 * Note: Server-side enforcement (Supabase Auth rate limits, PostgreSQL RPC
 * guards, and RLS) remains the authoritative security boundary.
 */

export interface RateLimitPolicy {
  /** Maximum allowed calls inside `windowMs`. */
  maxRequests: number;
  /** Sliding window duration in milliseconds. */
  windowMs: number;
  /** Optional persistent cooldown key in sessionStorage (for auth flows). */
  persistKey?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export const RATE_LIMITS = {
  usernameSearch: {
    maxRequests: 10,
    windowMs: 30_000,
  },
  friendRequest: {
    maxRequests: 5,
    windowMs: 60_000,
  },
  inviteGenerate: {
    maxRequests: 5,
    windowMs: 300_000,
  },
  expenseCreate: {
    maxRequests: 10,
    windowMs: 60_000,
  },
  settlementPropose: {
    maxRequests: 5,
    windowMs: 60_000,
  },
  authSignIn: {
    maxRequests: 5,
    windowMs: 60_000,
    persistKey: 'fs_rl_auth_signin',
  },
  authMagicLink: {
    maxRequests: 1,
    windowMs: 60_000,
    persistKey: 'fs_rl_auth_magic',
  },
  authPasswordReset: {
    maxRequests: 1,
    windowMs: 60_000,
    persistKey: 'fs_rl_auth_reset',
  },
} as const satisfies Record<string, RateLimitPolicy>;

const hitStore = new Map<string, number[]>();

function makeBucketKey(action: string, scope?: string): string {
  return scope ? `${action}:${scope}` : action;
}

function pruneHits(timestamps: number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  return timestamps.filter((ts) => ts > cutoff);
}

function readStoredExpiry(persistKey: string): number {
  try {
    const raw = sessionStorage.getItem(persistKey);
    if (!raw) return 0;
    const expiry = Number(raw);
    return Number.isFinite(expiry) && expiry > Date.now() ? expiry : 0;
  } catch {
    return 0;
  }
}

function writeStoredExpiry(persistKey: string, expiryMs: number): void {
  try {
    sessionStorage.setItem(persistKey, String(expiryMs));
  } catch {
    // Ignore storage unavailability (private browsing / restricted storage)
  }
}

export function clearStoredCooldown(persistKey: string): void {
  try {
    sessionStorage.removeItem(persistKey);
  } catch {
    // Ignore storage unavailability
  }
}

export function getCooldownRemainingSeconds(persistKey: string): number {
  const expiry = readStoredExpiry(persistKey);
  if (!expiry) return 0;
  return Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
}

export function setCooldownSeconds(persistKey: string, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    clearStoredCooldown(persistKey);
    return;
  }
  writeStoredExpiry(persistKey, Date.now() + Math.ceil(seconds) * 1000);
}

/**
 * Inspect whether an action is currently allowed without consuming a token.
 */
export function checkRateLimit(
  action: string,
  policy: RateLimitPolicy,
  scope?: string,
  now = Date.now()
): RateLimitResult {
  if (policy.persistKey) {
    const persistedExpiry = readStoredExpiry(policy.persistKey);
    if (persistedExpiry > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((persistedExpiry - now) / 1000)),
        remaining: 0,
      };
    }
  }

  const bucketKey = makeBucketKey(action, scope);
  const activeHits = pruneHits(hitStore.get(bucketKey) ?? [], now, policy.windowMs);
  hitStore.set(bucketKey, activeHits);

  if (activeHits.length >= policy.maxRequests) {
    const oldest = activeHits[0] ?? now;
    const retryAfterMs = Math.max(1000, oldest + policy.windowMs - now);
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      remaining: 0,
    };
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, policy.maxRequests - activeHits.length),
  };
}

/**
 * Record an attempt against the sliding window (and persistent cooldown if window fills).
 */
export function recordRateLimitHit(
  action: string,
  policy: RateLimitPolicy,
  scope?: string,
  now = Date.now()
): void {
  const bucketKey = makeBucketKey(action, scope);
  const activeHits = pruneHits(hitStore.get(bucketKey) ?? [], now, policy.windowMs);
  activeHits.push(now);
  hitStore.set(bucketKey, activeHits);

  if (policy.persistKey && activeHits.length >= policy.maxRequests) {
    const oldest = activeHits[0] ?? now;
    writeStoredExpiry(policy.persistKey, oldest + policy.windowMs);
  }
}

/**
 * Atomically check and consume one token if allowed.
 */
export function consumeRateLimit(
  action: string,
  policy: RateLimitPolicy,
  scope?: string,
  now = Date.now()
): RateLimitResult {
  const status = checkRateLimit(action, policy, scope, now);
  if (!status.allowed) return status;
  recordRateLimitHit(action, policy, scope, now);
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, status.remaining - 1),
  };
}

export function formatRateLimitMessage(actionLabel: string, retryAfterSeconds: number): string {
  const secs = Math.max(1, Math.ceil(retryAfterSeconds));
  return `Too many ${actionLabel}. Please wait ${secs}s before trying again.`;
}

/** Reset in-memory buckets (used in unit test cleanup or sign-out). */
export function resetRateLimits(): void {
  hitStore.clear();
  for (const policy of Object.values(RATE_LIMITS)) {
    if ('persistKey' in policy && policy.persistKey) {
      clearStoredCooldown(policy.persistKey);
    }
  }
}
