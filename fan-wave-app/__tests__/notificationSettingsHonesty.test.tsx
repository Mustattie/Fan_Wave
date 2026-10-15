/**
 * iOS UAT 2026-10-15 (SKYC-135). Three claims the screen could not back:
 *
 *  1. `permissionGranted` started as `true`, so OS permission was
 *     asserted granted before (and regardless of whether) it was read.
 *  2. A switch showing ON meant "saved", but was presented as though it
 *     meant "will be delivered" -- with notifications off at the OS
 *     level, six rows read ON while nothing could arrive.
 *  3. getNotificationPreferences() returns DEFAULT_PREFERENCES for a
 *     failed read, a signed-out user and a never-saved user alike. Since
 *     update_notification_preferences (mig 009) REPLACES the whole JSONB
 *     column, one toggle after a failed read wrote defaults over the
 *     user's real settings.
 */
import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';

jest.setTimeout(30_000);

const mockPermission = { status: 'granted' as string, throws: false };
const mockStored = { value: undefined as any, error: null as any, row: true as boolean };
const mockUpdate = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children }: any) => ReactLib.createElement(View, null, children),
  };
});
jest.mock('lucide-react-native', () => {
  const stub = () => null;
  return new Proxy({}, { get: () => stub });
});
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => {
    if (mockPermission.throws) throw new Error('unavailable in Expo Go');
    return { status: mockPermission.status };
  }),
}));
jest.mock('@/lib/notifications', () => {
  const DEFAULT_PREFERENCES = {
    score_updates: true,
    game_reminders: true,
    watch_party_reminders: true,
    group_activity: true,
    moment_alerts: false,
    clip_posted: false,
  };
  return {
    DEFAULT_PREFERENCES,
    PREFERENCE_LABELS: {
      score_updates: { title: 'Score Updates', description: 'Scores' },
      game_reminders: { title: 'Game Reminders', description: 'Reminders' },
      watch_party_reminders: { title: 'Watch Party Reminders', description: 'Parties' },
      group_activity: { title: 'Group Activity', description: 'Groups' },
      moment_alerts: { title: 'Moment Alerts', description: 'Moments' },
      clip_posted: { title: 'New Clips', description: 'Clips' },
    },
    updateNotificationPreferences: (...a: any[]) => mockUpdate(...a),
    registerForPushNotifications: jest.fn(async () => null),
  };
});

function mockBuilder() {
  const b: any = {};
  for (const m of ['select', 'eq']) b[m] = () => b;
  b.maybeSingle = () =>
    Promise.resolve({
      data: mockStored.row
        ? { notification_preferences: mockStored.value }
        : null,
      error: mockStored.error,
    });
  b.single = b.maybeSingle;
  return b;
}

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(() => mockBuilder()) },
  getLocalUser: jest.fn(async () => ({ data: { user: { id: 'me' } }, error: null })),
}));

import NotificationSettingsScreen, {
  mergeStoredPreferences,
  describeDelivery,
  readStoredPreferences,
} from '../app/notification-settings';

const SAVED = {
  score_updates: false,
  game_reminders: true,
  watch_party_reminders: false,
  group_activity: false,
  moment_alerts: true,
  clip_posted: false,
};

beforeEach(() => {
  mockPermission.status = 'granted';
  mockPermission.throws = false;
  mockStored.value = SAVED;
  mockStored.error = null;
  mockStored.row = true;
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(undefined);
});

describe('mergeStoredPreferences', () => {
  it('fills only the keys the column is missing', () => {
    const merged = mergeStoredPreferences({ score_updates: false });
    expect(merged.score_updates).toBe(false);
    expect(merged.game_reminders).toBe(true); // default
  });

  it('ignores non-boolean and unknown keys rather than rendering undefined', () => {
    const merged = mergeStoredPreferences({
      score_updates: 'yes',
      nonsense: true,
    });
    expect(merged.score_updates).toBe(true); // default, not 'yes'
    expect('nonsense' in merged).toBe(false);
  });

  it('survives a null or non-object column', () => {
    expect(mergeStoredPreferences(null).game_reminders).toBe(true);
    expect(mergeStoredPreferences('garbage').game_reminders).toBe(true);
  });
});

describe('describeDelivery', () => {
  it('separates "saved off" from "saved on but blocked by the OS"', () => {
    expect(describeDelivery('granted', true)).toBe('on');
    expect(describeDelivery('denied', true)).toBe('blocked');
    expect(describeDelivery('denied', false)).toBe('off');
    expect(describeDelivery('granted', false)).toBe('off');
  });

  it('does not guess when the OS state was never read', () => {
    expect(describeDelivery('unknown', true)).toBe('unknown');
  });
});

describe('readStoredPreferences', () => {
  it('reports what is stored, and that something was stored', async () => {
    const load = await readStoredPreferences();
    expect(load).toEqual({ status: 'loaded', preferences: SAVED, stored: true });
  });

  it('distinguishes a never-saved user from a failed read', async () => {
    mockStored.value = null;
    await expect(readStoredPreferences()).resolves.toMatchObject({
      status: 'loaded',
      stored: false,
    });

    mockStored.error = { message: 'boom' };
    await expect(readStoredPreferences()).resolves.toEqual({ status: 'unavailable' });
  });

  it('treats a missing users row as unavailable, because the write would no-op', async () => {
    mockStored.row = false;
    await expect(readStoredPreferences()).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('notification settings screen (SKYC-135)', () => {
  it('shows the saved preferences, not the defaults', async () => {
    const utils = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(utils.queryByText('Delivery is on')).toBeTruthy());
    // 2 of 6 saved as on (game_reminders, moment_alerts) -- the defaults
    // would have said 4.
    expect(utils.queryByText('2 of 6 notification types are on.')).toBeTruthy();
  });

  it('says nothing will be delivered when the OS says so, without changing a preference', async () => {
    mockPermission.status = 'denied';
    const utils = render(<NotificationSettingsScreen />);

    await waitFor(() =>
      expect(utils.queryByText('Nothing will be delivered')).toBeTruthy(),
    );
    // The preference the user saved is still shown as saved, and the row
    // states the gap between saved and delivered.
    expect(
      utils.queryAllByText('Saved, but not delivered while notifications are off'),
    ).toHaveLength(2);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not claim delivery is on before the OS has answered', async () => {
    mockPermission.throws = true;
    const utils = render(<NotificationSettingsScreen />);

    await waitFor(() =>
      expect(utils.queryByText('Delivery status unavailable')).toBeTruthy(),
    );
    expect(utils.queryByText('Delivery is on')).toBeNull();
    expect(utils.queryByText('Nothing will be delivered')).toBeNull();
  });

  it('refuses to write defaults over settings it could not read', async () => {
    mockStored.error = { message: 'boom' };
    const utils = render(<NotificationSettingsScreen />);

    await waitFor(() =>
      expect(utils.queryByText("Couldn't load your notification settings")).toBeTruthy(),
    );
    // Labelled as defaults, and locked.
    expect(utils.queryByText('NOTIFICATION TYPES (DEFAULTS)')).toBeTruthy();
    const switches = utils.UNSAFE_getAllByType(require('react-native').Switch);
    expect(switches.every((s: any) => s.props.disabled)).toBe(true);

    // Even if a toggle is forced through, nothing is sent.
    await act(async () => { switches[0]!.props.onValueChange?.(); });
    await waitFor(() => expect(mockUpdate).not.toHaveBeenCalled());
  });

  it('saves a toggle and confirms the column really holds it', async () => {
    const utils = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(utils.queryByText('Delivery is on')).toBeTruthy());

    // Flipping score_updates on; the confirming read returns the new value.
    mockUpdate.mockImplementation(async (prefs: any) => {
      mockStored.value = prefs;
    });
    const switches = utils.UNSAFE_getAllByType(require('react-native').Switch);
    await act(async () => { switches[0]!.props.onValueChange(); });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mock.calls[0]![0]).toEqual({ ...SAVED, score_updates: true });
    await waitFor(() =>
      expect(utils.queryByText('3 of 6 notification types are on.')).toBeTruthy(),
    );
  });

  it('reverts and says so when the save did not stick', async () => {
    const utils = render(<NotificationSettingsScreen />);
    await waitFor(() => expect(utils.queryByText('Delivery is on')).toBeTruthy());

    // The RPC resolves but the column is unchanged -- the silent no-op
    // the void-returning RPC cannot report.
    mockUpdate.mockResolvedValue(undefined);
    const switches = utils.UNSAFE_getAllByType(require('react-native').Switch);
    await act(async () => { switches[0]!.props.onValueChange(); });

    await waitFor(() =>
      expect(
        utils.queryByText('That did not save. Check your connection and try again.'),
      ).toBeTruthy(),
    );
    // Back to the stored truth rather than the optimistic guess.
    expect(utils.queryByText('2 of 6 notification types are on.')).toBeTruthy();
  });
});
