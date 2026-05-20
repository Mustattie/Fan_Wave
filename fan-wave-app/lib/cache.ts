import AsyncStorage from '@react-native-async-storage/async-storage';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const TTL = {
  // Games are live-updating via the ESPN cron (every 1 min while a game
  // is in progress). Keep this TTL short or AsyncStorage will serve
  // stale scores even after Realtime invalidates React Query — the
  // queryFn checks AsyncStorage first and returns hits.
  games: 30 * 1000,              // 30 seconds
  groups: 24 * 60 * 60 * 1000,   // 24 hours
  teams: 24 * 60 * 60 * 1000,    // 24 hours
  watchParties: 60 * 60 * 1000,  // 1 hour
  profile: 24 * 60 * 60 * 1000,  // 24 hours
} as const;

type CacheKey = keyof typeof TTL;

function cacheKeyStr(key: CacheKey, suffix?: string): string {
  return suffix ? `cache_${key}_${suffix}` : `cache_${key}`;
}

/**
 * Save data to cache with TTL.
 */
export async function setCache<T>(key: CacheKey, data: T, suffix?: string): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now() };
    await AsyncStorage.setItem(cacheKeyStr(key, suffix), JSON.stringify(entry));
  } catch {
    // Cache write failure is non-critical
  }
}

/**
 * Get cached data if it exists and hasn't expired.
 * Returns null if cache miss or expired.
 */
export async function getCache<T>(key: CacheKey, suffix?: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKeyStr(key, suffix));
    if (!raw) return null;

    const entry: CacheEntry<T> = JSON.parse(raw);
    const age = Date.now() - entry.timestamp;

    if (age > TTL[key]) {
      // Expired — remove it
      await AsyncStorage.removeItem(cacheKeyStr(key, suffix));
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Get cached data even if expired (for offline fallback).
 * Returns { data, isStale, ageMinutes } or null.
 */
export async function getStaleCache<T>(key: CacheKey, suffix?: string): Promise<{
  data: T;
  isStale: boolean;
  ageMinutes: number;
} | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKeyStr(key, suffix));
    if (!raw) return null;

    const entry: CacheEntry<T> = JSON.parse(raw);
    const age = Date.now() - entry.timestamp;

    return {
      data: entry.data,
      isStale: age > TTL[key],
      ageMinutes: Math.round(age / 60000),
    };
  } catch {
    return null;
  }
}

/**
 * Invalidate cache for a key.
 */
export async function invalidateCache(key: CacheKey, suffix?: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(cacheKeyStr(key, suffix));
  } catch {
    // Non-critical
  }
}

/**
 * Clear all cached data.
 */
export async function clearAllCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter((k) => k.startsWith('cache_'));
    if (cacheKeys.length > 0) {
      await AsyncStorage.multiRemove(cacheKeys);
    }
  } catch {
    // Non-critical
  }
}

// ── Offline Action Queue ─────────────────────────────────

interface QueuedAction {
  id: string;
  type: string;
  payload: Record<string, any>;
  createdAt: number;
}

const QUEUE_KEY = 'offline_action_queue';

/**
 * Queue an action to be performed when back online.
 */
export async function queueOfflineAction(type: string, payload: Record<string, any>): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue: QueuedAction[] = raw ? JSON.parse(raw) : [];
    queue.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      payload,
      createdAt: Date.now(),
    });
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Non-critical
  }
}

/**
 * Get all queued offline actions.
 */
export async function getOfflineQueue(): Promise<QueuedAction[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Clear the offline action queue (after successful sync).
 */
export async function clearOfflineQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(QUEUE_KEY);
  } catch {
    // Non-critical
  }
}
