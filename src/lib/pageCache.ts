/**
 * pageCache.ts — account-scoped in-memory read cache.
 *
 * Provides stale-while-revalidate semantics for frequently-viewed data (home
 * balances, friends list, groups list, activity feed, detail pages, search)
 * without caching auth secrets, treating cached balances as authoritative, or
 * persisting across logout/account-switch.
 *
 * Design constraints:
 *  - Memory-only (no IndexedDB / localStorage). Data expires on page reload
 *    and on account switch — safe for financial summary display.
 *  - Each cache slot is per-user-ID so switching accounts cannot see stale
 *    data from the previous session.
 *  - TTL-based expiry: fresh for 30 s (0 extra server calls when navigating
 *    between tabs), stale after 30 s (data is returned immediately while a
 *    fresh fetch runs in the background).
 *  - A page showing stale cached data renders a subtle refreshing indicator
 *    until the background refresh completes.
 *  - Bounded per-user entry count (LRU eviction) to prevent unbounded memory growth.
 *  - Cached values are read-only snapshots. Mutations must always go through
 *    the server and invalidate affected cache slots.
 *  - Cache is cleared on sign-out and account switch via clearCacheForUser().
 */

export const STALE_TTL_MS = 30_000; // 30 seconds
export const SEARCH_CACHE_TTL_MS = 60_000; // 60 seconds for username prefix lookups
const MAX_ENTRIES_PER_USER = 60;

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

interface CacheReadResult<T> {
  data: T | null;
  isStale: boolean; // true → show stale/refreshing indicator, trigger background refresh
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

export function readCache<T>(
  userId: string,
  key: string,
  ttlMs: number = STALE_TTL_MS
): CacheReadResult<T> {
  if (!userId) return { data: null, isStale: true };
  const userStore = getUserStore(userId);
  const entry = userStore.get(key) as CacheEntry<T> | undefined;
  if (!entry) return { data: null, isStale: true };
  // Refresh LRU insertion order
  userStore.delete(key);
  userStore.set(key, entry);
  const age = Date.now() - entry.cachedAt;
  return { data: entry.value, isStale: age >= ttlMs };
}

export function writeCache<T>(userId: string, key: string, value: T): void {
  if (!userId) return;
  const userStore = getUserStore(userId);
  if (userStore.has(key)) {
    userStore.delete(key);
  } else if (userStore.size >= MAX_ENTRIES_PER_USER) {
    const oldestKey = userStore.keys().next().value;
    if (oldestKey !== undefined) {
      userStore.delete(oldestKey);
    }
  }
  userStore.set(key, { value, cachedAt: Date.now() });
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

/**
 * Invalidate all ledger-derived caches for a user after any expense,
 * settlement, friend, or group mutation so subsequent views fetch fresh state.
 */
export function invalidateLedgerCaches(userId: string): void {
  if (!userId) return;
  invalidateCache(userId, CacheKey.homeBalances);
  invalidateCache(userId, CacheKey.friendsList);
  invalidateCache(userId, CacheKey.groupsList);
  invalidateCache(userId, CacheKey.activityFeed);
  invalidateCache(userId, CacheKey.notifications);
  invalidateCache(userId, CacheKey.settlementsList);
  invalidateCachePrefix(userId, 'friend:');
  invalidateCachePrefix(userId, 'group:');
  invalidateCachePrefix(userId, 'groupBalances:');
  invalidateCachePrefix(userId, 'expense:');
}

/** Call on sign-out or account switch to prevent another account from seeing prior data. */
export function clearCacheForUser(userId: string): void {
  store.delete(userId);
}

/** Clear all cached entries across all users (primarily for test isolation). */
export function clearAllCaches(): void {
  store.clear();
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
  settlementsList: 'settlements:list',
  friendDetail: (friendId: string) => `friend:${friendId}`,
  groupDetail: (groupId: string) => `group:${groupId}`,
  groupBalances: (groupId: string) => `groupBalances:${groupId}`,
  expenseDetail: (expenseId: string) => `expense:${expenseId}`,
  userSearch: (term: string) => `search:${term.trim().toLowerCase()}`,
} as const;
