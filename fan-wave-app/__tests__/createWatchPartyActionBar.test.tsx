// SKYC-129 (iOS UAT 2026-10-14): the Create Watch Party action bar.
//
// Two reports: with the venue field focused the sticky Next sat under the
// keyboard's predictive row (a tap meant for Next inserted a suggested
// word), and on step 3 the Public/Private cards shared a y-range with the
// Back/Create bar (a tap on "Public" hit Create).
//
// Both came from positions that were assumed rather than measured: a
// KeyboardAvoidingView that derived the lift from its own frame, and a
// hardcoded 120px tail that is shorter than the bar once the
// home-indicator inset is added. These tests pin the two numbers that
// replaced them — the bar lifts by the keyboard's reported height, and
// the step content clears the bar's measured height.
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { render, fireEvent, waitFor as rawWaitFor, act } from '@testing-library/react-native';

jest.setTimeout(60_000);
const waitFor = <T,>(fn: () => T) => rawWaitFor(fn, { timeout: 15_000 });

const BOTTOM_INSET = 34; // iPhone home indicator
const BAR_HEIGHT = 110;

let mockKeyboardHeight = 0;
jest.mock('@/hooks/useKeyboardHeight', () => ({
  useKeyboardHeight: () => mockKeyboardHeight,
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
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
jest.mock('@/hooks/useQueryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn() }));

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
      if (table === 'users') {
        return mockChain({ data: { home_city: 'McKinney', home_state: 'TX' }, error: null });
      }
      return mockChain({ data: [], error: null });
    }),
  },
}));

import CreateWatchPartyScreen from '../app/create-watch-party';

/** The bar reports its own height the way the native layout pass would. */
function layoutBar(utils: ReturnType<typeof render>, height = BAR_HEIGHT) {
  act(() => {
    fireEvent(utils.getByTestId('cwp-action-bar'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height } },
    });
  });
}

const barStyle = (utils: ReturnType<typeof render>) =>
  StyleSheet.flatten(utils.getByTestId('cwp-action-bar').props.style);

const scrollPadding = (utils: ReturnType<typeof render>) =>
  StyleSheet.flatten(utils.getByTestId('cwp-step-scroll').props.contentContainerStyle)
    ?.paddingBottom;

beforeEach(() => {
  mockKeyboardHeight = 0;
});

describe('SKYC-129 Create Watch Party action bar', () => {
  it('clears the step content by the bar height the bar actually reported', async () => {
    const utils = render(<CreateWatchPartyScreen />);
    await waitFor(() => utils.getByText('Where are you watching?'));

    layoutBar(utils, BAR_HEIGHT);
    // Clearance is derived, not a constant: the old 120 was less than a
    // 144pt bar and left the last cards under it.
    expect(scrollPadding(utils)).toBe(BAR_HEIGHT + 24);

    // A taller bar (two-button row, larger text) moves the clearance with it.
    layoutBar(utils, 144);
    expect(scrollPadding(utils)).toBe(168);
  });

  it('lifts the bar by the keyboard height so the predictive row cannot cover it', async () => {
    const utils = render(<CreateWatchPartyScreen />);
    await waitFor(() => utils.getByText('Where are you watching?'));
    expect(barStyle(utils).marginBottom).toBe(0);

    mockKeyboardHeight = 336; // keyboard + predictive row, as iOS reports it
    utils.rerender(<CreateWatchPartyScreen />);
    // Android resizes the window itself (app.json softwareKeyboardLayoutMode
    // = resize), so a margin there would lift the bar twice. This suite runs
    // under both platform presets; the expectation has to follow.
    expect(barStyle(utils).marginBottom).toBe(Platform.OS === 'ios' ? 336 : 0);
  });

  it('reserves the home-indicator inset only while the keyboard is down', async () => {
    const utils = render(<CreateWatchPartyScreen />);
    await waitFor(() => utils.getByText('Where are you watching?'));
    expect(barStyle(utils).paddingBottom).toBe(12 + BOTTOM_INSET);

    // The indicator is behind the keyboard; padding for it is wasted space.
    mockKeyboardHeight = 336;
    utils.rerender(<CreateWatchPartyScreen />);
    expect(barStyle(utils).paddingBottom).toBe(12);
  });

  it('keeps the clearance on the step that reported the overlap', async () => {
    const utils = render(<CreateWatchPartyScreen />);
    await waitFor(() => utils.getByText('Enter venue manually'));
    fireEvent.press(utils.getByText('Enter venue manually'));
    fireEvent.changeText(utils.getByPlaceholderText('Venue name'), 'The Garage');
    fireEvent.changeText(
      utils.getByPlaceholderText('Address (start typing to search...)'),
      '100 E Louisiana St',
    );
    fireEvent.press(utils.getByText('Next'));
    await waitFor(() => utils.getByText('Link a game (optional)'));
    fireEvent.press(utils.getByText('Skip'));
    await waitFor(() => utils.getByText('Party details'));

    layoutBar(utils, BAR_HEIGHT);
    // Step 3 is where Public/Private sat under the Create bar.
    expect(scrollPadding(utils)).toBe(BAR_HEIGHT + 24);
    utils.getByText('Public');
  });
});
