// SKYC-138 (iOS UAT 2026-10-14): the Los Angeles Dodgers wore the Miami Heat
// logo on a Game Day card while the same game rendered correctly on Home.
//
// Home and Game Day use byte-identical selects, the same mapper and the same
// GameCard, so neither query shape nor mapping explains a per-screen
// difference. The leading hypothesis -- not a confirmed diagnosis, since the
// two screens also hold independent caches and the team row's own logo_url has
// not been read -- is that TeamBadge rendered core RN <Image> with no key,
// inside horizontal FlatLists on both screens. Core <Image> holds the
// previously decoded bitmap until the new URI resolves, so a badge instance
// handed a different team can show the old team's logo for the length of the
// fetch.
//
// A second defect lived in the same component and needed no repro to see: the
// `logoFailed` boolean was never reset when `team.logoUrl` changed, so one
// failed load suppressed the logo for every team that instance was later
// handed.
//
// These tests pin both: the recycling key tracks the URL, and a failure is
// scoped to the URL that produced it.
import React from 'react';
import { render, act } from '@testing-library/react-native';

jest.setTimeout(30_000);

// expo-image's native view is stubbed as a plain View that keeps its props, so
// the test can read `recyclingKey` and invoke `onError` the way the native
// module would.
jest.mock('expo-image', () => {
  const RealReact = require('react');
  const { View } = require('react-native');
  return {
    Image: (props: any) =>
      RealReact.createElement(View, { testID: 'team-logo', ...props }),
  };
});

import { TeamBadge } from '@/components/TeamBadge';
import type { TeamDisplay } from '@/lib/mappers';

const dodgers: TeamDisplay = {
  name: 'Los Angeles Dodgers',
  icon: '⚾',
  code: 'LAD',
  logoUrl: 'https://a.espncdn.com/i/teamlogos/mlb/500/lad.png',
  primaryColor: '#005A9C',
};

const heat: TeamDisplay = {
  name: 'Miami Heat',
  icon: '🏀',
  code: 'MIA',
  logoUrl: 'https://a.espncdn.com/i/teamlogos/nba/500/mia.png',
  primaryColor: '#98002E',
};

describe('TeamBadge logo recycling', () => {
  it('keys the image on the logo URL so a reused view cannot keep the previous team logo', () => {
    const { getByTestId, rerender } = render(<TeamBadge team={heat} />);

    expect(getByTestId('team-logo').props.recyclingKey).toBe(heat.logoUrl);
    expect(getByTestId('team-logo').props.source).toEqual({ uri: heat.logoUrl });

    // The same component instance is handed a different team, which is exactly
    // what a re-rendering card list does. The key must move with it.
    rerender(<TeamBadge team={dodgers} />);

    expect(getByTestId('team-logo').props.recyclingKey).toBe(dodgers.logoUrl);
    expect(getByTestId('team-logo').props.source).toEqual({ uri: dodgers.logoUrl });
  });

  it('falls back to the code badge when the logo fails to load', () => {
    const { getByTestId, queryByTestId, getByText } = render(<TeamBadge team={dodgers} />);

    act(() => {
      getByTestId('team-logo').props.onError();
    });

    expect(queryByTestId('team-logo')).toBeNull();
    expect(getByText('LAD')).toBeTruthy();
  });

  it('scopes a load failure to the URL that failed, not to the component instance', () => {
    const { getByTestId, queryByTestId, rerender } = render(<TeamBadge team={dodgers} />);

    act(() => {
      getByTestId('team-logo').props.onError();
    });
    expect(queryByTestId('team-logo')).toBeNull();

    // Before the fix, `logoFailed` stayed true for the life of the instance,
    // so this second team rendered as a colored circle even though its own
    // logo had never been tried.
    rerender(<TeamBadge team={heat} />);

    expect(getByTestId('team-logo').props.source).toEqual({ uri: heat.logoUrl });
  });

  it('does not reinstate a logo for the URL that already failed', () => {
    const { getByTestId, queryByTestId, rerender } = render(<TeamBadge team={dodgers} />);

    act(() => {
      getByTestId('team-logo').props.onError();
    });

    rerender(<TeamBadge team={heat} />);
    rerender(<TeamBadge team={dodgers} />);

    expect(queryByTestId('team-logo')).toBeNull();
  });

  // Codex review, 2026-10-20: the first version tracked only the most recent
  // failed URL, so a second failure forgot the first and the badge retried a
  // logo it already knew was broken. Every failure has to stick.
  it('remembers every failed URL, not just the most recent one', () => {
    const { getByTestId, queryByTestId, rerender } = render(<TeamBadge team={dodgers} />);

    act(() => {
      getByTestId('team-logo').props.onError();
    });
    expect(queryByTestId('team-logo')).toBeNull();

    rerender(<TeamBadge team={heat} />);
    act(() => {
      getByTestId('team-logo').props.onError();
    });
    expect(queryByTestId('team-logo')).toBeNull();

    rerender(<TeamBadge team={dodgers} />);
    expect(queryByTestId('team-logo')).toBeNull();

    rerender(<TeamBadge team={heat} />);
    expect(queryByTestId('team-logo')).toBeNull();
  });

  it('uses the code badge when the team has no logo at all', () => {
    const { queryByTestId, getByText } = render(
      <TeamBadge team={{ ...dodgers, logoUrl: null }} />,
    );

    expect(queryByTestId('team-logo')).toBeNull();
    expect(getByText('LAD')).toBeTruthy();
  });
});
