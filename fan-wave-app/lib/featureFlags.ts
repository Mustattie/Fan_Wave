import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { FeatureFlag } from '@/types';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CachedFlag {
  flag: FeatureFlag;
  cachedAt: number;
}

async function getCached(key: string): Promise<CachedFlag | null> {
  try {
    const storageKey = `ff_${key}`;
    let raw: string | null = null;

    if (Platform.OS === 'web') {
      raw = localStorage.getItem(storageKey);
    } else {
      raw = await AsyncStorage.getItem(storageKey);
    }

    if (!raw) return null;

    const cached: CachedFlag = JSON.parse(raw);
    if (Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached;
    }
    return null;
  } catch {
    return null;
  }
}

async function setCached(key: string, flag: FeatureFlag): Promise<void> {
  try {
    const storageKey = `ff_${key}`;
    const value = JSON.stringify({ flag, cachedAt: Date.now() });

    if (Platform.OS === 'web') {
      localStorage.setItem(storageKey, value);
    } else {
      await AsyncStorage.setItem(storageKey, value);
    }
  } catch {
    // Silently fail on cache write errors
  }
}

async function fetchFlag(key: string): Promise<FeatureFlag | null> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('*')
    .eq('key', key)
    .single();

  if (error || !data) return null;
  return data as FeatureFlag;
}

function isFlagActive(flag: FeatureFlag, ignoreDateWindow = false): boolean {
  if (!flag.enabled) return false;

  if (!ignoreDateWindow) {
    const now = new Date();
    if (flag.start_date && now < new Date(flag.start_date)) return false;
    if (flag.end_date && now > new Date(flag.end_date)) return false;
  }

  return true;
}

const DEFAULT_FLAG_VALUES: Record<string, boolean> = {
  world_cup_mode: true,
};

export async function isFeatureActive(key: string, options?: { ignoreDateWindow?: boolean }): Promise<boolean> {
  try {
    const ignoreDateWindow = options?.ignoreDateWindow ?? false;
    const cached = await getCached(key);
    if (cached) {
      return isFlagActive(cached.flag, ignoreDateWindow);
    }

    const flag = await fetchFlag(key);
    if (!flag) return DEFAULT_FLAG_VALUES[key] ?? false;

    await setCached(key, flag);
    return isFlagActive(flag, ignoreDateWindow);
  } catch {
    return DEFAULT_FLAG_VALUES[key] ?? false;
  }
}

export async function getFeatureConfig<T = Record<string, any>>(
  key: string
): Promise<T | null> {
  try {
    const cached = await getCached(key);
    if (cached) {
      return isFlagActive(cached.flag) ? (cached.flag.config as T) : null;
    }

    const flag = await fetchFlag(key);
    if (!flag) return null;

    await setCached(key, flag);
    return isFlagActive(flag) ? (flag.config as T) : null;
  } catch {
    return null;
  }
}

export async function clearFeatureFlagCache(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('ff_')) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } else {
      const allKeys = await AsyncStorage.getAllKeys();
      const ffKeys = (allKeys as string[]).filter((k) => k.startsWith('ff_'));
      for (const k of ffKeys) {
        await AsyncStorage.removeItem(k);
      }
    }
  } catch {
    // Silently fail on cache clear errors
  }
}
