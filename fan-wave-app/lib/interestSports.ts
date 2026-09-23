// The user's sport interests, as Home and Game Day filter on them.
//
// Build 28 UAT (2026-09-24): both tabs read this once, in a mount-only
// effect, and tab screens stay mounted for the life of the process -- so
// a change made on My Sports (which writes AsyncStorage and invalidates
// the games query, but cannot reach the tabs' local state) showed up only
// after an app relaunch. Both tabs now reload on focus through this one
// function, and only re-render when the set actually changed.
//
// This is the immediate-refresh fix (register item C1's part A). Part B,
// persisting the picks server-side so a second device sees them, is a
// separate change and is not needed for the tab to refresh.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, getLocalUser } from './supabase';

export const SELECTED_SPORTS_KEY = 'selected_sports';

/**
 * Union of the device's My Sports picks and the sports of the user's
 * followed teams (via get_user_teams). Empty set = no signals = no filter.
 * Never throws: a storage or network failure degrades to whatever half
 * was readable.
 */
export async function loadInterestSports(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const raw = await AsyncStorage.getItem(SELECTED_SPORTS_KEY);
    const fromStorage: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(fromStorage)) {
      for (const s of fromStorage) set.add(String(s).toLowerCase());
    }
  } catch {
    /* unreadable storage -- fall through to follows */
  }
  try {
    const { data: { user } } = await getLocalUser();
    if (user) {
      const { data: follows } = await supabase.rpc('get_user_teams', {
        p_user_id: user.id,
      });
      for (const row of (follows || []) as Array<{ sport_name?: string | null }>) {
        if (row.sport_name) set.add(String(row.sport_name).toLowerCase());
      }
    }
  } catch {
    /* network failure -- the device picks alone are fine */
  }
  return set;
}

/** Order-insensitive equality, so an unchanged reload does not re-render. */
export function sameStringSet(a: Set<string> | null, b: Set<string>): boolean {
  if (!a || a.size !== b.size) return false;
  for (const v of b) if (!a.has(v)) return false;
  return true;
}
