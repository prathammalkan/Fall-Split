import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkRateLimit,
  consumeRateLimit,
  formatRateLimitMessage,
  getCooldownRemainingSeconds,
  RATE_LIMITS,
  recordRateLimitHit,
  resetRateLimits,
  setCooldownSeconds,
} from './rateLimiter';

describe('rateLimiter — on-device sliding window and cooldown protection', () => {
  beforeEach(() => {
    resetRateLimits();
    sessionStorage.clear();
  });

  it('allows up to maxRequests within windowMs and blocks excess calls', () => {
    const policy = { maxRequests: 3, windowMs: 10_000 };
    const t0 = 1_000_000;

    expect(consumeRateLimit('search', policy, 'u1', t0)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      remaining: 2,
    });
    expect(consumeRateLimit('search', policy, 'u1', t0 + 100)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      remaining: 1,
    });
    expect(consumeRateLimit('search', policy, 'u1', t0 + 200)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
      remaining: 0,
    });

    const blocked = consumeRateLimit('search', policy, 'u1', t0 + 500);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBe(10);
  });

  it('isolates rate limit buckets by user scope', () => {
    const policy = { maxRequests: 1, windowMs: 30_000 };
    const now = 2_000_000;

    expect(consumeRateLimit('invite', policy, 'user-a', now).allowed).toBe(true);
    expect(consumeRateLimit('invite', policy, 'user-a', now + 100).allowed).toBe(false);
    expect(consumeRateLimit('invite', policy, 'user-b', now + 100).allowed).toBe(true);
  });

  it('recovers capacity once the sliding window expires', () => {
    const policy = { maxRequests: 2, windowMs: 5_000 };
    const t0 = 5_000_000;

    consumeRateLimit('req', policy, 'u1', t0);
    consumeRateLimit('req', policy, 'u1', t0 + 1000);
    expect(checkRateLimit('req', policy, 'u1', t0 + 2000).allowed).toBe(false);

    // After t0 + 5000ms, the oldest hit expires
    const afterWindow = checkRateLimit('req', policy, 'u1', t0 + 5001);
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.remaining).toBe(1);
  });

  it('persists cooldowns in sessionStorage across check calls', () => {
    const key = RATE_LIMITS.authMagicLink.persistKey;
    setCooldownSeconds(key, 45);
    const remaining = getCooldownRemainingSeconds(key);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(45);

    const status = checkRateLimit('authMagicLink', RATE_LIMITS.authMagicLink);
    expect(status.allowed).toBe(false);
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('records persistent cooldown when authSignIn limit is reached', () => {
    const now = Date.now();
    for (let i = 0; i < RATE_LIMITS.authSignIn.maxRequests; i++) {
      recordRateLimitHit('authSignIn', RATE_LIMITS.authSignIn, undefined, now + i);
    }
    const status = checkRateLimit('authSignIn', RATE_LIMITS.authSignIn, undefined, now + 500);
    expect(status.allowed).toBe(false);
    expect(getCooldownRemainingSeconds(RATE_LIMITS.authSignIn.persistKey)).toBeGreaterThan(0);
  });

  it('formats user-friendly cooldown messages', () => {
    expect(formatRateLimitMessage('username searches', 12)).toBe(
      'Too many username searches. Please wait 12s before trying again.'
    );
    expect(formatRateLimitMessage('requests', 0)).toBe(
      'Too many requests. Please wait 1s before trying again.'
    );
  });
});
