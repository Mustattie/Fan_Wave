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
 * The two independent signals behind the interest filter, kept apart.
 *
 * iOS UAT 2026-10-15 (SKYC-139): My Sports read the device picks alone
 * while Home and Game Day filtered on the union, so a sport the user
 * reached only through a followed team was shaping their feed without
 * appearing on the screen that is supposed to show what they follow --
 * and the "N following" line under-reported it. My Sports needs the two
 * halves separately, because only one of them is editable there: a pick
 * can be tapped off, a team-derived sport cannot (it goes away when the
 * team is unfollowed). Merging them into one set before the UI sees them
 * is what made the distinction unexpressible.
 *
 * `picks` are the device's My Sports selections (sport ids, lowercased).
 * `followed` are the sports of the user's followed teams, as
 * get_user_teams names them (lowercased); those names are not guaranteed
 * to be sport ids, so treat them as tokens, not keys.
 *
 * Never throws: a storage or network failure degrades to whatever half
 * was readable, and says which half that was.
 */
export type InterestSportSources = {
  picks: Set<string>;
  followed: Set<string>;
  /** False when get_user_teams could not be read (offline, signed out). */
  followedLoaded: boolean;
};

export async function loadInterestSportSources(): Promise<InterestSportSources> {
  const picks = new Set<string>();
  const followed = new Set<string>();
  let followedLoaded = false;
  try {
    const raw = await AsyncStorage.getItem(SELECTED_SPORTS_KEY);
    const fromStorage: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(fromStorage)) {
      for (const s of fromStorage) picks.add(String(s).toLowerCase());
    }
  } catch {
    /* unreadable storage -- fall through to follows */
  }
  try {
    const { data: { user } } = await getLocalUser();
    if (user) {
      const { data: follows, error } = await supabase.rpc('get_user_teams', {
        p_user_id: user.id,
      });
      if (error) throw error;
      for (const row of (follows || []) as Array<{ sport_name?: string | null }>) {
        if (row.sport_name) followed.add(String(row.sport_name).toLowerCase());
      }
      followedLoaded = true;
    }
  } catch {
    /* network failure -- the device picks alone are fine */
  }
  return { picks, followed, followedLoaded };
}

/**
 * Union of the device's My Sports picks and the sports of the user's
 * followed teams (via get_user_teams). Empty set = no signals = no filter.
 * Never throws: a storage or network failure degrades to whatever half
 * was readable.
 *
 * Home and Game Day consume this; it is deliberately the same union it
 * has always been, built from the one reader above so the editor on My
 * Sports and the filter on the tabs cannot drift apart.
 */
export async function loadInterestSports(): Promise<Set<string>> {
  const { picks, followed } = await loadInterestSportSources();
  const set = new Set<string>(picks);
  for (const s of followed) set.add(s);
  return set;
}

/** Order-insensitive equality, so an unchanged reload does not re-render. */
export function sameStringSet(a: Set<string> | null, b: Set<string>): boolean {
  if (!a || a.size !== b.size) return false;
  for (const v of b) if (!a.has(v)) return false;
  return true;
}
