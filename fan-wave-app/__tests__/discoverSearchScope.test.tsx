/**
 * iOS UAT 2026-10-15 (SKYC-128): Discover's search box reached only the
 * Suggested-groups query and the watch-party query. The Joined tab kept
 * showing every membership while a query was in effect, the "Fan Groups"
 * header counted Suggested no matter which sub-tab was open, and a query
 * that matched nothing rendered the browse-time empty state -- "No public
 * groups yet — be the first to start one!" -- which is a false statement
 * about the catalogue rather than a report about the search.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.setTimeout(30_000);

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const ReactLib = require('react');
    ReactLib.useEffect(cb, [cb]);
  },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children }: any) => ReactLib.createElement(View, null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('lucide-react-native', () => {
  const stub = () => null;
  return new Proxy({}, { get: () => stub });
});
jest.mock('expo-contacts', () => ({
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getContactsAsync: jest.fn(async () => ({ data: [] })),
  Fields: { Name: 'name', PhoneNumbers: 'phoneNumbers' },
}));
jest.mock('@/lib/inviteContacts', () => ({
  loadContactsWithPhones: jest.fn(async () => []),
  pickPhoneForContact: jest.fn(async () => null),
  openSmsInvite: jest.fn(async () => undefined),
  buildGroupInviteBody: jest.fn(() => 'invite'),
}));
jest.mock('@/lib/realtime', () => ({
  subscribeToWatchParties: jest.fn(() => () => {}),
}));
jest.mock('@/lib/errorReporting', () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock('@/components/SportPill', () => ({
  SportPillRow: () => null,
}));
jest.mock('@/components/SectionHeader', () => ({
  SectionHeader: ({ title }: any) => {
    const ReactLib = require('react');
    const { Text } = require('react-native');
    return ReactLib.createElement(Text, null, title);
  },
}));
jest.mock('@/components/WatchPartyCard', () => ({
  WatchPartyCard: ({ party }: any) => {
    const ReactLib = require('react');
    const { Text } = require('react-native');
    return ReactLib.createElement(Text, null, party.title);
  },
}));
jest.mock('@/components/GroupCard', () => ({
  GroupCard: ({ group, isMember }: any) => {
    const ReactLib = require('react');
    const { Text } = require('react-native');
    return ReactLib.createElement(
      Text,
      null,
      `${group.name}${isMember ? ' · member' : ''}`,
    );
  },
}));

// ─── Fixture ────────────────────────────────────────────────────────────
// Two memberships and four public rooms, two of which are the rooms the
// user is already in -- the suggested query does not filter on membership
// server-side, so they come back and only the client dedupes them.
//
// Chosen so the counts discriminate: "fans" matches both memberships and
// one other room, and "lakers" matches one membership and nothing else,
// which is the case where a Suggested-only count reported 0 results for a
// search that had in fact found one of the user's own groups.
const ROOM_LAKERS = { id: 'r-lakers', name: 'Lakers Fans NYC', member_count: 12 };
const ROOM_MAVS = { id: 'r-mavs', name: 'Mavs Fans Crew', member_count: 4 };
const ROOM_HEAT = { id: 'r-heat', name: 'Heat Fans Miami', member_count: 30 };
const ROOM_RANGERS = { id: 'r-rangers', name: 'Rangers Nation', member_count: 7 };

type Call = [string, ...any[]];

function ilikeArg(calls: Call[]): string | null {
  const hit = calls.find((c) => c[0] === 'ilike' && c[1] === 'name');
  return hit ? String(hit[2]) : null;
}

function orArg(calls: Call[]): string | null {
  const hit = calls.find((c) => c[0] === 'or');
  return hit ? String(hit[1]) : null;
}

function respond(table: string, calls: Call[]) {
  if (table === 'users') return { data: { home_city: null }, error: null };
  if (table === 'chat_room_members') {
    return {
      data: [{ chat_rooms: ROOM_LAKERS }, { chat_rooms: ROOM_MAVS }],
      error: null,
    };
  }
  if (table === 'chat_rooms') {
    // Mimic `name ilike %q%` server-side.
    const pattern = ilikeArg(calls);
    const rooms = [ROOM_HEAT, ROOM_RANGERS, ROOM_LAKERS, ROOM_MAVS].map((r) => ({
      ...r,
      owner_id: 'someone-else',
      visibility: 'public',
    }));
    if (!pattern) return { data: rooms, error: null };
    const needle = pattern.replace(/%/g, '').toLowerCase();
    return {
      data: rooms.filter((r) => r.name.toLowerCase().includes(needle)),
      error: null,
    };
  }
  if (table === 'watch_parties') {
    // No parties in this fixture; the search `or(...)` is still recorded
    // so the test can assert the query was scoped.
    void orArg(calls);
    return { data: [], error: null };
  }
  return { data: [], error: null };
}

function makeBuilder(table: string) {
  const calls: Call[] = [];
  const b: any = {};
  for (const m of [
    'select', 'eq', 'neq', 'gt', 'lt', 'order', 'limit', 'ilike', 'or', 'in', 'filter', 'insert',
  ]) {
    b[m] = (...args: any[]) => {
      calls.push([m, ...args]);
      return b;
    };
  }
  for (const m of ['single', 'maybeSingle']) {
    b[m] = (...args: any[]) => {
      calls.push([m, ...args]);
      return Promise.resolve(respond(table, calls));
    };
  }
  b.then = (onOk: any, onErr: any) =>
    Promise.resolve(respond(table, calls)).then(onOk, onErr);
  return b;
}

// The factory is hoisted above makeBuilder, and jest only lets a factory
// close over identifiers prefixed `mock` -- hence the indirection.
const mockBuilderRef: { current: (table: string) => any } = {
  current: (table: string) => makeBuilder(table),
};

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn((table: string) => mockBuilderRef.current(table)) },
  getLocalUser: jest.fn(async () => ({ data: { user: { id: 'me' } }, error: null })),
}));

import DiscoverScreen, { matchesGroupSearch, sanitizeSearch } from '../app/(tabs)/discover';

const SEARCH_PLACEHOLDER = 'Search groups and watch parties...';

async function renderDiscover() {
  const utils = render(<DiscoverScreen />);
  // Browse state: both of the user's groups and the public rooms land.
  await waitFor(() => expect(utils.queryByText('Joined (2)')).toBeTruthy(), {
    timeout: 5000,
  });
  return utils;
}

async function search(utils: ReturnType<typeof render>, text: string) {
  fireEvent.changeText(utils.getByPlaceholderText(SEARCH_PLACEHOLDER), text);
  // 300 ms debounce, then the queries. Waiting for the settled wording
  // ("N results for ...") rather than the pending one ("Searching for
  // ...") guarantees the assertions below read post-query state.
  await waitFor(
    () => expect(utils.queryByText(new RegExp(`results? for "${text}"`))).toBeTruthy(),
    { timeout: 5000 },
  );
}

describe('discover search sanitising', () => {
  it('strips the ilike wildcard and the PostgREST or-delimiter', () => {
    expect(sanitizeSearch('  lak%ers,  ')).toBe('lak ers');
    expect(sanitizeSearch(undefined)).toBe('');
    expect(sanitizeSearch('%%')).toBe('');
  });

  it('matches the server predicate: case-insensitive substring, empty = everything', () => {
    expect(matchesGroupSearch('Lakers Fans NYC', 'lakers')).toBe(true);
    expect(matchesGroupSearch('Lakers Fans NYC', 'LAKERS')).toBe(true);
    expect(matchesGroupSearch('Mavs Fans Crew', 'lakers')).toBe(false);
    expect(matchesGroupSearch('Mavs Fans Crew', '   ')).toBe(true);
    expect(matchesGroupSearch(null, 'lakers')).toBe(false);
  });
});

describe('Discover search scope (SKYC-128)', () => {
  it('narrows the Joined tab, not just Suggested', async () => {
    const utils = await renderDiscover();
    fireEvent.press(utils.getByText('Joined (2)'));
    expect(utils.queryByText(/Mavs Fans Crew/)).toBeTruthy();
    expect(utils.queryByText(/Lakers Fans NYC/)).toBeTruthy();

    await search(utils, 'lakers');

    // The Joined list is now the query's matches, not the whole
    // membership list sitting under a search header.
    expect(utils.queryByText('Joined (1)')).toBeTruthy();
    expect(utils.queryByText(/Mavs Fans Crew/)).toBeNull();
    expect(utils.queryByText(/Lakers Fans NYC/)).toBeTruthy();
  });

  it('counts the open sub-tab, not whichever list happens to be fetched', async () => {
    const utils = await renderDiscover();
    await search(utils, 'fans');

    // Suggested is the default tab: Heat Fans Miami only, because the
    // user's own two "Fans" groups are deduped out of it.
    expect(utils.queryByText('Suggested (1)')).toBeTruthy();
    expect(utils.queryByText('Joined (2)')).toBeTruthy();
    expect(utils.queryByText('Fan Groups (1)')).toBeTruthy();

    fireEvent.press(utils.getByText('Joined (2)'));
    // The header count follows the tab the user is looking at.
    expect(utils.queryByText('Fan Groups (2)')).toBeTruthy();
  });

  it('totals every matched surface, including the user\'s own groups', async () => {
    const utils = await renderDiscover();
    await search(utils, 'fans');
    // 2 joined + 1 suggested + 0 watch parties. The old header would have
    // said "1" here, counting Suggested alone.
    expect(utils.queryByText('3 results for "fans"')).toBeTruthy();
  });

  it('keeps a group the user already belongs to out of Suggested while searching', async () => {
    const utils = await renderDiscover();
    await search(utils, 'fans');

    // The suggested query returns the user's own rooms (it cannot filter
    // on membership), so only the client dedupe keeps them out -- and
    // that dedupe has to key off membership, not the search-filtered
    // Joined list, or adding the Joined search would have let a group the
    // user is in reappear under "Suggested" with a Join button.
    expect(utils.queryByText(/Heat Fans Miami/)).toBeTruthy();
    expect(utils.queryByText(/Lakers Fans NYC/)).toBeNull();
    expect(utils.queryByText(/Mavs Fans Crew/)).toBeNull();
  });

  it('says where the matches are when the open tab has none', async () => {
    const utils = await renderDiscover();
    // "lakers" matches one of the user's groups and no other public room.
    await search(utils, 'lakers');

    expect(utils.queryByText('1 result for "lakers"')).toBeTruthy();
    expect(utils.queryByText(/No groups match "lakers"/)).toBeTruthy();
    expect(utils.queryByText('See 1 in your groups')).toBeTruthy();

    fireEvent.press(utils.getByText('See 1 in your groups'));
    expect(utils.queryByText(/Lakers Fans NYC/)).toBeTruthy();
  });

  it('reports an empty search as an empty search, not an empty catalogue', async () => {
    const utils = await renderDiscover();
    await search(utils, 'zzz');

    expect(utils.queryByText('0 results for "zzz"')).toBeTruthy();
    expect(utils.queryByText(/No groups match "zzz"/)).toBeTruthy();
    expect(utils.queryByText(/No public groups yet/)).toBeNull();
    expect(utils.queryByText(/No watch parties match "zzz"/)).toBeTruthy();
    expect(utils.queryByText(/host the first one/)).toBeNull();

    fireEvent.press(utils.getByText('Joined (0)'));
    expect(utils.queryByText(/None of your groups match "zzz"/)).toBeTruthy();
    expect(utils.queryByText(/Your crew awaits/)).toBeNull();
  });

  it('offers a way back out of a search that found nothing', async () => {
    const utils = await renderDiscover();
    await search(utils, 'zzz');

    fireEvent.press(utils.getByText('Clear search'));
    await waitFor(() => expect(utils.queryByText('Joined (2)')).toBeTruthy(), {
      timeout: 5000,
    });
    expect(utils.queryByText(/results for/)).toBeNull();
    expect(utils.queryByText(/Rangers Nation/)).toBeTruthy();
  });
});
