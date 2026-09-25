// Create Watch Party wizard: derived state must follow the linked game.
//
// Build 29/30 UAT found two halves of the same defect: the start time was
// seeded from "Tonight 7PM" and never read the linked game (v9.5.19), and
// the auto title stuck to the first game after the host changed it
// (v9.5.20). This drives the real screen through venue -> game A -> details
// -> back -> game B -> details -> create and asserts that title, chips,
// summary line, game_id and starts_at all describe game B.

import React from 'react';
import { render, fireEvent, waitFor as rawWaitFor, act } from '@testing-library/react-native';

// The screen is large and the suite runs in parallel workers; the default
// 1 s waitFor flaked once under load. Generous ceilings, same assertions.
jest.setTimeout(60_000);
const waitFor = <T,>(fn: () => T) => rawWaitFor(fn, { timeout: 15_000 });

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('lucide-react-native', () => {
  const stub = () => null;
  return new Proxy({}, { get: () => stub });
});
jest.mock('expo-contacts', () => ({
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getContactsAsync: jest.fn(async () => ({ data: [] })),
  Fields: { Name: 'name', PhoneNumbers: 'phoneNumbers' },
}));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getLastKnownPositionAsync: jest.fn(async () => null),
  getCurrentPositionAsync: jest.fn(async () => null),
  Accuracy: { Balanced: 3 },
}));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('@/components/paywall/PaywallGate', () => ({
  PaywallGate: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/venueSearchApi', () => ({
  searchVenues: jest.fn(async () => ({ venues: [], status: 'ok' })),
  geocodeCity: jest.fn(async () => null),
  searchAddress: jest.fn(async () => [
    { lat: 33.1972, lon: -96.6153, city: 'McKinney', label: '100 E Louisiana St, McKinney, TX' },
  ]),
  resetVenueBreakers: jest.fn(),
}));
jest.mock('@/lib/addressCity', () => ({ cityFromAddress: () => 'McKinney' }));
jest.mock('@/lib/cache', () => ({ invalidateCache: jest.fn() }));
jest.mock('@/hooks/useQueryClient', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn() }));

let mockParams: Record<string, string> = {};

// One fake Supabase client: a `games` list for step 2, a `users` profile
// with a home city (so the screen never asks for GPS), a `watch_parties`
// insert that records its payload, and no-op RSVP/invite inserts.
const mockInserted: any[] = [];
const HOUR = 60 * 60 * 1000;
const mockNow = Date.now();
const mockGameA = {
  id: 'game-a',
  scheduled_at: new Date(mockNow + 5 * HOUR).toISOString(),
  status: 'scheduled',
  sport_id: 'wnba',
  home_team: { name: 'Minnesota Lynx' },
  away_team: { name: 'Indiana Fever' },
};
const mockGameB = {
  id: 'game-b',
  scheduled_at: new Date(mockNow + 6 * HOUR).toISOString(),
  status: 'scheduled',
  sport_id: 'nhl',
  home_team: { name: 'Vancouver Canucks' },
  away_team: { name: 'Edmonton Oilers' },
};

function mockChain(result: any) {
  const c: any = {};
  for (const m of ['select', 'eq', 'gt', 'order', 'limit', 'ilike', 'insert']) {
    c[m] = jest.fn(() => c);
  }
  c.maybeSingle = jest.fn(async () => result);
  c.single = jest.fn(async () => result);
  c.then = (resolve: any) => Promise.resolve(result).then(resolve);
  return c;
}

jest.mock('@/lib/supabase', () => ({
  getLocalUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
  supabase: {
    from: jest.fn((table: string) => {
      if (table === 'games') return mockChain({ data: [mockGameA, mockGameB], error: null });
      if (table === 'users') {
        return mockChain({ data: { home_city: 'McKinney', home_state: 'TX' }, error: null });
      }
      if (table === 'sports') return mockChain({ data: null, error: null });
      if (table === 'watch_parties') {
        const c = mockChain({ data: { id: 'party-1' }, error: null });
        c.insert = jest.fn((row: any) => {
          mockInserted.push(row);
          return c;
        });
        return c;
      }
      return mockChain({ data: null, error: null });
    }),
  },
}));

import CreateWatchPartyScreen from '../app/create-watch-party';
import { formatGameTimeChip } from '../lib/partyTimePresets';

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
// The chip carries a weekday when the game falls on another local day, so
// the expected label comes from the same helper the screen uses.
const chipA = () => formatGameTimeChip(mockGameA.scheduled_at);
const chipB = () => formatGameTimeChip(mockGameB.scheduled_at);

async function reachStep2(utils: ReturnType<typeof render>) {
  const { getByText, getByPlaceholderText } = utils;
  await waitFor(() => getByText('Enter venue manually'));
  fireEvent.press(getByText('Enter venue manually'));
  fireEvent.changeText(getByPlaceholderText('Venue name'), 'The Garage');
  // The BUG-13 guard geocodes a typed address at create time.
  fireEvent.changeText(getByPlaceholderText('Address (start typing to search...)'), '100 E Louisiana St');
  fireEvent.press(getByText('Next'));
  await waitFor(() => getByText('Link a game (optional)'));
  // The games list is loaded asynchronously.
  await waitFor(() => getByText(/Minnesota Lynx/));
}

describe('Create Watch Party wizard: derived state follows the linked game', () => {
  beforeEach(() => {
    mockParams = {};
    mockInserted.length = 0;
  });

  it('switching game A -> B updates title, chips, summary, game_id and starts_at together', async () => {
    const utils = render(<CreateWatchPartyScreen />);
    const { getByText, getAllByText, getByPlaceholderText, queryByText } = utils;
    await reachStep2(utils);

    // Game A -> Party details.
    fireEvent.press(getByText(/Minnesota Lynx/));
    fireEvent.press(getByText('Next'));
    await waitFor(() => getByText('Party details'));
    expect(getByPlaceholderText('Watch Party Title').props.value).toBe(
      'Minnesota Lynx vs Indiana Fever',
    );
    expect(getByText(chipA())).toBeTruthy();
    expect(getByText('30 min before')).toBeTruthy();
    expect(getByText('1 hr before')).toBeTruthy();
    // The fixed presets are hidden while a usable game time exists.
    expect(queryByText(/Tonight|Tomorrow/)).toBeNull();

    // Back, choose game B, forward again.
    fireEvent.press(getByText('Back'));
    await waitFor(() => getByText('Link a game (optional)'));
    fireEvent.press(getByText(/Vancouver Canucks/));
    fireEvent.press(getByText('Next'));
    await waitFor(() => getByText('Party details'));

    // Every derived value now describes game B.
    expect(getByPlaceholderText('Watch Party Title').props.value).toBe(
      'Vancouver Canucks vs Edmonton Oilers',
    );
    expect(queryByText(chipA())).toBeNull();
    expect(getByText(chipB())).toBeTruthy();
    // The summary line nests the value in its own Text: "Starts <value>".
    const summaryValue = getByText(/^Starts/).props.children.find((c: any) => typeof c === 'object');
    expect(summaryValue.props.children).toContain(localTime(mockGameB.scheduled_at));

    await act(async () => {
      fireEvent.press(getAllByText('Create Watch Party').pop()!);
    });
    await waitFor(() => expect(mockInserted).toHaveLength(1));
    expect(mockInserted[0]).toMatchObject({
      title: 'Vancouver Canucks vs Edmonton Oilers',
      game_id: 'game-b',
      starts_at: mockGameB.scheduled_at,
      creator_id: 'user-1',
    });
  });

  it('keeps a title the host typed and a time the host chose across a game change', async () => {
    const utils = render(<CreateWatchPartyScreen />);
    const { getByText, getAllByText, getByPlaceholderText } = utils;
    await reachStep2(utils);

    fireEvent.press(getByText(/Minnesota Lynx/));
    fireEvent.press(getByText('Next'));
    await waitFor(() => getByText('Party details'));
    fireEvent.changeText(getByPlaceholderText('Watch Party Title'), 'Lynx night at The Garage');
    fireEvent.press(getByText('30 min before'));

    fireEvent.press(getByText('Back'));
    await waitFor(() => getByText('Link a game (optional)'));
    fireEvent.press(getByText(/Vancouver Canucks/));
    fireEvent.press(getByText('Next'));
    await waitFor(() => getByText('Party details'));

    // Host's title and chosen time survive; the chips still derive from B.
    expect(getByPlaceholderText('Watch Party Title').props.value).toBe('Lynx night at The Garage');
    expect(getByText(chipB())).toBeTruthy();

    await act(async () => {
      fireEvent.press(getAllByText('Create Watch Party').pop()!);
    });
    await waitFor(() => expect(mockInserted).toHaveLength(1));
    // "30 min before" was chosen against game A and is kept as the host's
    // decision: exactly 30 minutes before A, not re-derived from B.
    expect(new Date(mockGameA.scheduled_at).getTime() - new Date(mockInserted[0].starts_at).getTime())
      .toBe(30 * 60 * 1000);
    expect(mockInserted[0].game_id).toBe('game-b');
  });

  it('unlinking the game restores the general presets and a venue title', async () => {
    const utils = render(<CreateWatchPartyScreen />);
    const { getByText, getAllByText, getByPlaceholderText, queryByText } = utils;
    await reachStep2(utils);

    fireEvent.press(getByText(/Minnesota Lynx/));
    fireEvent.press(getByText('Next'));
    await waitFor(() => getByText('Party details'));
    fireEvent.press(getByText('Back'));
    await waitFor(() => getByText('Link a game (optional)'));
    fireEvent.press(getByText(/General watch party/));
    fireEvent.press(getByText('Next'));
    await waitFor(() => getByText('Party details'));

    expect(getByPlaceholderText('Watch Party Title').props.value).toBe('Watch Party at The Garage');
    expect(queryByText(/^Game time/)).toBeNull();
    expect(getAllByText(/Tonight|Tomorrow/).length).toBeGreaterThan(0);
    expect(getByText('Choose date & time…')).toBeTruthy();
  });

  it('links the game named in the route param and defaults to its time', async () => {
    mockParams = { gameId: 'game-b' };
    const utils = render(<CreateWatchPartyScreen />);
    const { getByText, getByPlaceholderText } = utils;
    await reachStep2(utils);
    // Already selected: the button reads Next (not Skip).
    fireEvent.press(getByText('Next'));
    await waitFor(() => getByText('Party details'));
    expect(getByPlaceholderText('Watch Party Title').props.value).toBe(
      'Vancouver Canucks vs Edmonton Oilers',
    );
    expect(getByText(chipB())).toBeTruthy();
  });
});
