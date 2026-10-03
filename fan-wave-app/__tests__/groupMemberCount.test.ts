// Build 33 UAT finding (2026-10-03): the group header's member count went
// stale on the existing member's device after a second account joined.
import { supabase } from '@/lib/supabase';
import {
  fetchGroupMemberCount,
  applyMemberCount,
  presenceUserIds,
  presenceRosterChanged,
  becameActive,
} from '../lib/groupMemberCount';

function mockRoomRow(result: { data: any; error: any }) {
  const single = jest.fn(() => Promise.resolve(result));
  const eq = jest.fn(() => ({ single }));
  const select = jest.fn(() => ({ eq }));
  (supabase.from as jest.Mock).mockReturnValueOnce({ select });
  return { select, eq, single };
}

describe('fetchGroupMemberCount', () => {
  it('reads chat_rooms.member_count for the room', async () => {
    const m = mockRoomRow({ data: { member_count: 2 }, error: null });
    await expect(fetchGroupMemberCount('room-1')).resolves.toBe(2);
    expect(supabase.from).toHaveBeenCalledWith('chat_rooms');
    expect(m.select).toHaveBeenCalledWith('member_count');
    expect(m.eq).toHaveBeenCalledWith('id', 'room-1');
  });

  it('returns null on a query error or a missing row', async () => {
    mockRoomRow({ data: null, error: { message: 'boom' } });
    await expect(fetchGroupMemberCount('room-1')).resolves.toBeNull();
    mockRoomRow({ data: null, error: null });
    await expect(fetchGroupMemberCount('room-1')).resolves.toBeNull();
  });

  it('returns null when the column is not numeric', async () => {
    mockRoomRow({ data: { member_count: 'n/a' }, error: null });
    await expect(fetchGroupMemberCount('room-1')).resolves.toBeNull();
  });
});

describe('applyMemberCount', () => {
  const roomA = { id: 'room-a', memberCount: 1, name: 'A' };
  const roomB = { id: 'room-b', memberCount: 5, name: 'B' };

  it('updates the count for the room the response belongs to', () => {
    expect(applyMemberCount(roomA, 'room-a', 2)).toEqual({ ...roomA, memberCount: 2 });
  });

  it('returns the same object when the value is unchanged (no render)', () => {
    expect(applyMemberCount(roomA, 'room-a', 1)).toBe(roomA);
    expect(applyMemberCount(null, 'room-a', 1)).toBeNull();
  });

  it("drops a deferred response from a room that is no longer mounted", async () => {
    // Room A's refetch is in flight when the route switches to room B; A's
    // response resolves afterwards and must not land on B.
    let resolveA: (n: number) => void = () => {};
    const pendingA = new Promise<number>((r) => { resolveA = r; });
    let state: typeof roomA | null = roomA;
    const refetchFor = (roomId: string, p: Promise<number>) =>
      p.then((n) => { state = applyMemberCount(state, roomId, n); });
    const inflight = refetchFor('room-a', pendingA);
    state = roomB; // route switched before A resolved
    resolveA(2);
    await inflight;
    expect(state).toBe(roomB);
    expect(state!.memberCount).toBe(5);
  });
});

describe('presenceUserIds', () => {
  it('collects distinct user ids across presence keys, sorted, ignoring anon', () => {
    const state = {
      k1: [{ user_id: 'u-b', online_at: 't' }],
      k2: [{ user_id: 'u-a' }, { user_id: 'u-b' }],
      k3: [{ user_id: 'anon' }, {}],
    };
    expect(presenceUserIds(state)).toEqual(['u-a', 'u-b']);
    expect(presenceUserIds(null)).toEqual([]);
  });
});

describe('presenceRosterChanged', () => {
  it('treats the first sync as the baseline, not a change', () => {
    expect(presenceRosterChanged(null, ['u-a'])).toBe(false);
  });

  it('is false while the roster is unchanged (heartbeats, re-syncs)', () => {
    expect(presenceRosterChanged(['u-a', 'u-b'], ['u-a', 'u-b'])).toBe(false);
  });

  it('is true when someone joins or leaves', () => {
    expect(presenceRosterChanged(['u-a'], ['u-a', 'u-b'])).toBe(true);
    expect(presenceRosterChanged(['u-a', 'u-b'], ['u-a'])).toBe(true);
    expect(presenceRosterChanged(['u-a'], ['u-c'])).toBe(true);
  });
});

describe('becameActive', () => {
  it('fires only on the transition into active from background/inactive', () => {
    expect(becameActive('background', 'active')).toBe(true);
    expect(becameActive('inactive', 'active')).toBe(true);
    expect(becameActive('active', 'active')).toBe(false);
    expect(becameActive('active', 'background')).toBe(false);
    expect(becameActive('active', 'inactive')).toBe(false);
    // first observation: no previous state, nothing to return from
    expect(becameActive(null, 'active')).toBe(false);
  });

  it('background -> membership change (roster unchanged) -> return still refetches', () => {
    // The roster comparison alone would stay silent; the AppState
    // transition is what carries the refetch in that sequence.
    const roster = ['u-a'];
    expect(presenceRosterChanged(roster, roster)).toBe(false);
    expect(becameActive('background', 'active')).toBe(true);
  });
});
