/**
 * iOS UAT 2026-10-15 (SKYC-145): with no votes cast, the Fan MVP sheet
 * showed "50%" on both team cards over a half-and-half bar, directly
 * above the line "No votes yet — be the first." The percentages were a
 * placeholder (`total > 0 ? ... : 50`) rendered in the same style as real
 * results, and the bar floored each fill at `Math.max(pct, 1)` so a side
 * with zero votes always kept a sliver.
 */
import React from 'react';

jest.setTimeout(30_000);
import { render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('lucide-react-native', () => {
  const stub = () => null;
  return new Proxy({}, { get: () => stub });
});
jest.mock('@/components/TeamBadge', () => ({
  TeamBadge: () => null,
}));
jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn() }));

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: any[]) => mockRpc(...args) },
  getLocalUser: jest.fn(async () => ({ data: { user: { id: 'me' } }, error: null })),
}));

import { MvpVoteSheet } from '../components/MvpVoteSheet';

const homeTeam = { id: 'h', name: 'Mavericks', abbreviation: 'DAL', logoUrl: null } as any;
const awayTeam = { id: 'a', name: 'Lakers', abbreviation: 'LAL', logoUrl: null } as any;

function renderSheet() {
  return render(
    <MvpVoteSheet
      visible
      onClose={() => {}}
      gameId="g-1"
      homeTeam={homeTeam}
      awayTeam={awayTeam}
      homeTeamId="h"
      awayTeamId="a"
    />,
  );
}

beforeEach(() => {
  mockRpc.mockReset();
});

describe('MvpVoteSheet zero-vote display (SKYC-145)', () => {
  it('shows no percentage at all when nobody has voted', async () => {
    mockRpc.mockResolvedValue({
      data: [{ home_votes: 0, away_votes: 0, my_vote: null }],
      error: null,
    });
    const utils = renderSheet();

    await waitFor(() => expect(utils.queryByText('No votes yet — be the first.')).toBeTruthy());
    // The invented dead heat is gone...
    expect(utils.queryAllByText('50%')).toHaveLength(0);
    // ...replaced by an explicit "unknown" on both cards.
    expect(utils.queryAllByText('—')).toHaveLength(2);
    expect(utils.queryAllByText('no votes')).toHaveLength(2);
  });

  it('shows real percentages once there are real votes', async () => {
    mockRpc.mockResolvedValue({
      data: [{ home_votes: 3, away_votes: 1, my_vote: null }],
      error: null,
    });
    const utils = renderSheet();

    await waitFor(() => expect(utils.queryByText('75%')).toBeTruthy());
    expect(utils.queryByText('25%')).toBeTruthy();
    expect(utils.queryByText('3 votes')).toBeTruthy();
    expect(utils.queryByText('1 vote')).toBeTruthy();
    expect(utils.queryByText('4 fans have voted')).toBeTruthy();
    expect(utils.queryAllByText('—')).toHaveLength(0);
  });

  it('reports a one-sided tally as 0%, not as a sliver', async () => {
    mockRpc.mockResolvedValue({
      data: [{ home_votes: 0, away_votes: 5, my_vote: null }],
      error: null,
    });
    const utils = renderSheet();

    await waitFor(() => expect(utils.queryByText('100%')).toBeTruthy());
    expect(utils.queryByText('0%')).toBeTruthy();
    expect(utils.queryByText('0 votes')).toBeTruthy();
    expect(utils.queryByText('5 fans have voted')).toBeTruthy();
  });

  it('does not pass off a failed tally read as "no votes yet"', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const utils = renderSheet();

    await waitFor(() =>
      expect(
        utils.queryByText("Couldn't load the vote count. Your pick will still count."),
      ).toBeTruthy(),
    );
    expect(utils.queryByText('No votes yet — be the first.')).toBeNull();
  });
});
