import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import {
  WC_TEAMS,
  WC_VENUES,
  WC_MATCHES,
  WCTeam,
  WCVenue,
  WCMatch,
} from '@/constants/WorldCupData';

const CACHE_KEY = 'wc_data_bundle';
const CACHE_VERSION_KEY = 'wc_data_version';
const REMOTE_TABLE = 'world_cup_config';

export interface WorldCupDataBundle {
  teams: WCTeam[];
  venues: WCVenue[];
  matches: WCMatch[];
  source: 'remote' | 'cache' | 'static';
  version: number;
}

// ---------------------------------------------------------------------------
// Storage helpers (cross-platform)
// ---------------------------------------------------------------------------
async function readFromStorage(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    }
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function writeToStorage(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        localStorage.setItem(key, value);
      }
    } else {
      await AsyncStorage.setItem(key, value);
    }
  } catch {
    // Silently fail on storage write errors
  }
}

// ---------------------------------------------------------------------------
// Remote fetch
// ---------------------------------------------------------------------------
async function fetchRemoteBundle(): Promise<WorldCupDataBundle | null> {
  try {
    const { data, error } = await supabase
      .from(REMOTE_TABLE)
      .select('teams, venues, matches, version')
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;

    return {
      teams: data.teams as WCTeam[],
      venues: data.venues as WCVenue[],
      matches: data.matches as WCMatch[],
      source: 'remote',
      version: data.version as number,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cache read / write
// ---------------------------------------------------------------------------
async function readCachedBundle(): Promise<WorldCupDataBundle | null> {
  try {
    const raw = await readFromStorage(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as WorldCupDataBundle;
    return { ...parsed, source: 'cache' };
  } catch {
    return null;
  }
}

async function writeBundleToCache(bundle: WorldCupDataBundle): Promise<void> {
  try {
    await writeToStorage(CACHE_KEY, JSON.stringify(bundle));
    await writeToStorage(CACHE_VERSION_KEY, String(bundle.version));
  } catch {
    // Silently fail
  }
}

// ---------------------------------------------------------------------------
// Static fallback
// ---------------------------------------------------------------------------
function getStaticBundle(): WorldCupDataBundle {
  return {
    teams: WC_TEAMS,
    venues: WC_VENUES,
    matches: WC_MATCHES,
    source: 'static',
    version: 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get World Cup data with priority chain: remote -> cache -> static.
 * Silently falls through to the next source on failure.
 */
export async function getWorldCupData(): Promise<WorldCupDataBundle> {
  // 1. Try remote
  const remote = await fetchRemoteBundle();
  if (remote) {
    // Update cache in the background
    writeBundleToCache(remote);
    return remote;
  }

  // 2. Try cache
  const cached = await readCachedBundle();
  if (cached) {
    return cached;
  }

  // 3. Fall back to static data
  return getStaticBundle();
}

/**
 * Force a remote fetch, update cache, and return the bundle.
 * Falls back to cache then static if remote is unavailable.
 */
export async function refreshWorldCupData(): Promise<WorldCupDataBundle> {
  const remote = await fetchRemoteBundle();
  if (remote) {
    await writeBundleToCache(remote);
    return remote;
  }

  // If remote fails, still try cache
  const cached = await readCachedBundle();
  if (cached) {
    return cached;
  }

  return getStaticBundle();
}

/**
 * Clear the local World Cup data cache.
 */
export async function clearWorldCupCache(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_VERSION_KEY);
      }
    } else {
      await AsyncStorage.removeItem(CACHE_KEY);
      await AsyncStorage.removeItem(CACHE_VERSION_KEY);
    }
  } catch {
    // Silently fail
  }
}
