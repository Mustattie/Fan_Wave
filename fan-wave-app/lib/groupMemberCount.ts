// Fan-group header member count: keep it current across devices.
//
// Build 33 UAT (2026-10-03, Codex finding): after a second account joined
// "Anaheim Ducks Fans" from the phone, the emulator -- the existing member,
// sitting on the group screen -- kept showing "1 member · 2 online" through a
// deep-link reopen and a two-minute background/return. The screen reads
// chat_rooms.member_count once on mount and only bumps it locally on its own
// Join; chat_room_members is not in the realtime publication (mig 052 added
// messages, media_clips, watch_party_rsvps, match_moments only), so nothing
// told the other device. Presence IS shared, though: a new member's device
// subscribes to presence right after joining, so the existing member's
// presence sync is the cheapest signal that the roster changed. The screen
// refetches the count when that roster changes, whenever it regains
// navigation focus, and when the app returns to the foreground (navigation
// focus does not change while the app is backgrounded).

import type { AppStateStatus } from 'react-native';
import { supabase } from '@/lib/supabase';

/** Current chat_rooms.member_count, or null when it cannot be read. */
export async function fetchGroupMemberCount(groupId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('chat_rooms')
      .select('member_count')
      .eq('id', groupId)
      .single();
    if (error || !data) return null;
    const n = Number((data as { member_count?: unknown }).member_count);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * State updater for a fetched count. The response was requested for
 * `roomId`; it must only land on that room (the mounted route can switch
 * from room A to room B while A's request is still pending), and only a
 * changed value may produce a new object (and so a render).
 */
export function applyMemberCount<T extends { id: string; memberCount: number }>(
  prev: T | null,
  roomId: string,
  memberCount: number,
): T | null {
  if (!prev || prev.id !== roomId || prev.memberCount === memberCount) return prev;
  return { ...prev, memberCount };
}

/**
 * Distinct user ids present in a presence sync payload, sorted so two
 * payloads with the same roster compare equal. Entries without a user_id
 * (the 'anon' placeholder) are ignored.
 */
export function presenceUserIds(state: Record<string, any[]> | null | undefined): string[] {
  const ids = new Set<string>();
  for (const entries of Object.values(state ?? {})) {
    for (const entry of entries ?? []) {
      const uid = entry?.user_id;
      if (typeof uid === 'string' && uid && uid !== 'anon') ids.add(uid);
    }
  }
  return [...ids].sort();
}

/**
 * True when the roster differs from the previous one. The first sync
 * (prev === null) is the baseline, not a change: the mount-time load has
 * just read the count, so refetching again would only duplicate it.
 */
export function presenceRosterChanged(prev: string[] | null, next: string[]): boolean {
  if (prev === null) return false;
  if (prev.length !== next.length) return true;
  return prev.some((id, i) => id !== next[i]);
}

/**
 * True on the transition into 'active' from background/inactive. A join
 * that happened while the app was backgrounded leaves the presence roster
 * unchanged on return (the joiner may already have left the screen) and
 * navigation focus never changed, so the return itself must refetch.
 */
export function becameActive(prev: AppStateStatus | null, next: AppStateStatus): boolean {
  return next === 'active' && prev !== null && prev !== 'active';
}
