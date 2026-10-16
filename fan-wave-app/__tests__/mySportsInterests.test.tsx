/**
 * iOS UAT 2026-10-15.
 *
 * SKYC-139: My Sports read AsyncStorage 'selected_sports' directly while
 * Home and Game Day filter on loadInterestSports(), which is the UNION of
 * those picks and the sports of the user's followed teams. A sport the
 * user reached only through a followed team therefore shaped their feeds
 * while this screen showed it as unselected and left it out of the "N
 * following" count. The two halves are now read through one function and
 * kept distinguishable, because only the picks half is editable here.
 *
 * SKYC-140: the grid is 3 columns of flex:1 cards in a space-between row,
 * over 8 sports -- the last row's 2 cards each stretched to half the
 * width, twice the size of every card above them.
 */
import { SPORTS } from '../constants/Sports';

jest.setTimeout(30_000);

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock('lucide-react-native', () => {
  const stub = () => null;
  return new Proxy({}, { get: () => stub });
});
jest.mock('react-native-safe-area-context', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children }: any) => ReactLib.createElement(View, null, children),
  };
});
jest.mock('@/hooks/useQueryClient', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));

const mockGetItem = jest.fn();
const mockSetItem = jest.fn(async () => undefined);
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...a: any[]) => mockGetItem(...a),
  setItem: (...a: any[]) => mockSetItem(...(a as [])),
  removeItem: jest.fn(async () => undefined),
}));

const mockRpc = jest.fn();
const mockGetLocalUser = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: any[]) => mockRpc(...a) },
  getLocalUser: (...a: any[]) => mockGetLocalUser(...a),
}));

import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react-native';
import {
  loadInterestSports,
  loadInterestSportSources,
  SELECTED_SPORTS_KEY,
} from '../lib/interestSports';
import MySportsScreen, {
  padSportsForGrid,
  matchFollowedToGrid,
} from '../app/my-sports';

beforeEach(() => {
  mockGetItem.mockReset();
  mockSetItem.mockReset();
  mockSetItem.mockResolvedValue(undefined as never);
  mockRpc.mockReset();
  mockGetLocalUser.mockReset();
  mockGetItem.mockResolvedValue(null);
  mockRpc.mockResolvedValue({ data: [], error: null });
  mockGetLocalUser.mockResolvedValue({ data: { user: { id: 'me' } }, error: null });
});

describe('loadInterestSportSources (SKYC-139)', () => {
  it('keeps device picks and team-derived sports apart', async () => {
    mockGetItem.mockResolvedValue(JSON.stringify(['NFL', 'mlb']));
    mockRpc.mockResolvedValue({
      data: [{ sport_name: 'NBA' }, { sport_name: 'MLB' }],
      error: null,
    });

    const { picks, followed, followedLoaded } = await loadInterestSportSources();
    expect([...picks].sort()).toEqual(['mlb', 'nfl']);
    expect([...followed].sort()).toEqual(['mlb', 'nba']);
    expect(followedLoaded).toBe(true);
    // 'mlb' is in both: it is a pick AND team-derived, and the two facts
    // have to survive separately -- removing the pick does not remove it
    // from the feed.
    expect(picks.has('mlb')).toBe(true);
    expect(followed.has('mlb')).toBe(true);
    expect(mockGetItem).toHaveBeenCalledWith(SELECTED_SPORTS_KEY);
  });

  it('still produces exactly the union the feeds have always filtered on', async () => {
    mockGetItem.mockResolvedValue(JSON.stringify(['nfl']));
    mockRpc.mockResolvedValue({ data: [{ sport_name: 'NBA' }], error: null });

    const union = await loadInterestSports();
    expect([...union].sort()).toEqual(['nba', 'nfl']);
  });

  it('degrades to the readable half, and says which half that was', async () => {
    // Unreadable storage: follows alone.
    mockGetItem.mockRejectedValue(new Error('storage gone'));
    mockRpc.mockResolvedValue({ data: [{ sport_name: 'NHL' }], error: null });
    let sources = await loadInterestSportSources();
    expect([...sources.picks]).toEqual([]);
    expect([...sources.followed]).toEqual(['nhl']);
    expect(sources.followedLoaded).toBe(true);

    // Network down: picks alone, and followedLoaded is false so a caller
    // cannot mistake "no follows" for "could not read follows".
    mockGetItem.mockResolvedValue(JSON.stringify(['cbb']));
    mockRpc.mockRejectedValue(new Error('offline'));
    sources = await loadInterestSportSources();
    expect([...sources.picks]).toEqual(['cbb']);
    expect([...sources.followed]).toEqual([]);
    expect(sources.followedLoaded).toBe(false);
  });

  it('treats a signed-out user as follows-unknown, not follows-empty', async () => {
    mockGetLocalUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetItem.mockResolvedValue(JSON.stringify(['nfl']));

    const sources = await loadInterestSportSources();
    expect([...sources.picks]).toEqual(['nfl']);
    expect(sources.followedLoaded).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('ignores a storage payload that is not an array of sports', async () => {
    mockGetItem.mockResolvedValue(JSON.stringify({ nfl: true }));
    const sources = await loadInterestSportSources();
    expect([...sources.picks]).toEqual([]);
  });
});

describe('matchFollowedToGrid (SKYC-139)', () => {
  it('maps a followed sport name onto the grid card it belongs to', () => {
    const { gridIds, unmatched } = matchFollowedToGrid(new Set(['nfl', 'NBA', 'mls']));
    expect([...gridIds].sort()).toEqual(['mls', 'nba', 'nfl']);
    expect(unmatched).toEqual([]);
  });

  it('matches on the display name too, not just the id', () => {
    // sports.name for the college leagues is 'College FB' / 'College BB'.
    const { gridIds } = matchFollowedToGrid(new Set(['College FB']));
    expect([...gridIds]).toEqual(['cfb']);
  });

  it('reports a followed sport with no card instead of guessing one', () => {
    const { gridIds, unmatched } = matchFollowedToGrid(
      new Set(['nfl', 'college football', 'cricket']),
    );
    expect([...gridIds]).toEqual(['nfl']);
    // Named, so the count the screen prints can still account for them.
    expect(unmatched).toEqual(['college football', 'cricket']);
  });
});

describe('My Sports screen (SKYC-139)', () => {
  async function renderScreen() {
    const utils = render(<MySportsScreen />);
    await waitFor(() => expect(utils.queryByText(/following/)).toBeTruthy(), {
      timeout: 5000,
    });
    return utils;
  }

  beforeEach(() => {
    // One pick, plus a sport the user only reaches through a followed team.
    mockGetItem.mockResolvedValue(JSON.stringify(['nfl']));
    mockRpc.mockResolvedValue({ data: [{ sport_name: 'NBA' }], error: null });
  });

  it('counts the sports the feeds actually filter on, not just the picks', async () => {
    const utils = await renderScreen();
    // The old line read "1 following" while Home filtered on two sports.
    expect(
      utils.queryByText(/2 following · 1 from teams you follow/),
    ).toBeTruthy();
  });

  it('marks a team-derived sport as such instead of as a pick', async () => {
    const utils = await renderScreen();
    expect(utils.queryByText('via your teams')).toBeTruthy();
    expect(
      utils.queryByLabelText('NBA, in your feed from a team you follow'),
    ).toBeTruthy();
    expect(utils.queryByLabelText('NFL, following')).toBeTruthy();
    expect(utils.queryByLabelText('MLB, not following')).toBeTruthy();
  });

  it('still deselects a pick on tap, exactly as before', async () => {
    const utils = await renderScreen();
    fireEvent.press(utils.getByLabelText('NFL, following'));

    await waitFor(() => expect(utils.queryByLabelText('NFL, not following')).toBeTruthy());
    expect(utils.queryByText(/1 following · 1 from teams you follow/)).toBeTruthy();
    expect(mockSetItem).toHaveBeenCalledWith(SELECTED_SPORTS_KEY, JSON.stringify([]));
  });

  it('explains the one tap whose card stays lit, rather than looking broken', async () => {
    const utils = await renderScreen();
    // Pick NBA (already team-derived), then unpick it.
    fireEvent.press(utils.getByLabelText('NBA, in your feed from a team you follow'));
    await waitFor(() => expect(utils.queryByLabelText('NBA, following')).toBeTruthy());
    expect(utils.queryByText(/2 following/)).toBeTruthy();
    expect(utils.queryByText('via your teams')).toBeNull();

    fireEvent.press(utils.getByLabelText('NBA, following'));
    await waitFor(() =>
      expect(
        utils.queryByText(/It still appears in your feeds because you follow a team in it/),
      ).toBeTruthy(),
    );
    // And it is honestly back to the team-derived look, not switched off.
    expect(
      utils.queryByLabelText('NBA, in your feed from a team you follow'),
    ).toBeTruthy();
  });

  it('names a followed sport that has no card, instead of hiding it from the count', async () => {
    mockRpc.mockResolvedValue({
      data: [{ sport_name: 'College Football' }],
      error: null,
    });
    const utils = await renderScreen();
    expect(
      utils.queryByText(/Also in your feeds from teams you follow: college football/),
    ).toBeTruthy();
    expect(utils.queryByText(/2 following · 1 from teams you follow/)).toBeTruthy();
  });
});

describe('padSportsForGrid (SKYC-140)', () => {
  it('pads a short final row so its cards keep the normal width', () => {
    const cells = padSportsForGrid(SPORTS, 3);
    expect(cells.length % 3).toBe(0);
    expect(cells.filter((c) => c.kind === 'sport')).toHaveLength(SPORTS.length);
    // 8 sports over 3 columns: one filler closes the last row.
    expect(cells.filter((c) => c.kind === 'filler')).toHaveLength(1);
  });

  it('adds nothing when the rows already divide evenly', () => {
    const six = SPORTS.slice(0, 6);
    const cells = padSportsForGrid(six, 3);
    expect(cells).toHaveLength(6);
    expect(cells.every((c) => c.kind === 'sport')).toBe(true);
  });

  it('keeps every key unique so FlatList does not collide them', () => {
    const keys = padSportsForGrid(SPORTS, 3).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the sports in order and leaves a single-column list alone', () => {
    const cells = padSportsForGrid(SPORTS, 1);
    expect(cells.map((c) => (c.kind === 'sport' ? c.sport.id : 'filler'))).toEqual(
      SPORTS.map((s) => s.id),
    );
  });
});
