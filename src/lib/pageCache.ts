/**
 * pageCache.ts — account-scoped in-memory read cache.
 *
 * Provides stale-while-revalidate semantics for frequently-viewed data (home
 * balances, friends list, groups list, activity feed) without caching auth
 * secrets, treating cached balances as authoritative, or persisting across
 * logout/account-switch.
 *
 * Design constraints:
 *  - Memory-only (no IndexedDB / localStorage). Data expires on page reload
 *    and on account switch — safe for financial summary display.
 *  - Each cache slot is per-user-ID so switching accounts cannot see stale
 *    data from the previous session.
 *  - TTL-based expiry: stale after 30 s, data is returned while a fresh fetch
 *    is triggered in the background.
 *  - A page that shows cached data MUST render a visible stale indicator until
 *    the background refresh completes.
 *  - Cached values are read-only snapshots. Mutations must always go through
 *    the server and invalidate affected cache slots.
 *  - Cache is cleared on sign-out via clearCacheForUser().
 *
 * Usage:
 *   const { data, isStale } = readCache<T>(userId, key);
 *   writeCache(userId, key, value);
 *   invalidateCache(userId, key);       // after a mutation
 *   clearCacheForUser(userId);          // on sign-out
 */

const STALE_TTL_MS = 30_000; // 30 seconds

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

interface CacheReadResult<T> {
  data: T | null;
  isStale: boolean; // true → show stale indicator, trigger background refresh
}

// Outer key is userId, inner key is cache slot name.
const store = new Map<string, Map<string, CacheEntry<unknown>>>();

function getUserStore(userId: string): Map<string, CacheEntry<unknown>> {
  let userStore = store.get(userId);
  if (!userStore) {
    userStore = new Map();
    store.set(userId, userStore);
  }
  return userStore;
}

export function readCache<T>(userId: string, key: string): CacheReadResult<T> {
  if (!userId) return { data: null, isStale: true };
  const entry = getUserStore(userId).get(key) as CacheEntry<T> | undefined;
  if (!entry) return { data: null, isStale: true };
  const age = Date.now() - entry.cachedAt;
  return { data: entry.value, isStale: age >= STALE_TTL_MS };
}

export function writeCache<T>(userId: string, key: string, value: T): void {
  if (!userId) return;
  getUserStore(userId).set(key, { value, cachedAt: Date.now() });
}

export function invalidateCache(userId: string, key: string): void {
  if (!userId) return;
  getUserStore(userId).delete(key);
}

export function invalidateCachePrefix(userId: string, prefix: string): void {
  if (!userId) return;
  const userStore = getUserStore(userId);
  for (const k of userStore.keys()) {
    if (k.startsWith(prefix)) userStore.delete(k);
  }
}

/** Call on sign-out to prevent a new account from seeing the previous user's data. */
export function clearCacheForUser(userId: string): void {
  store.delete(userId);
}

// ---------------------------------------------------------------------------
// Named cache keys (centralised to prevent key typos across callers)
// ---------------------------------------------------------------------------
export const CacheKey = {
  homeBalances: 'home:balances',
  friendsList: 'friends:list',
  groupsList: 'groups:list',
  activityFeed: 'activity:feed',
  notifications: 'notifications:list',
} as const;
