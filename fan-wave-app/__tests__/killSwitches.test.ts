import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@/lib/errorReporting', () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import { supabase } from '../lib/supabase';
import {
  isFeatureEnabled,
  refreshKillSwitches,
  applyKillSwitchRows,
  initKillSwitches,
  _resetKillSwitchesForTests,
} from '../lib/killSwitches';

function mockFlags(result: { data: any; error: any } | (() => Promise<any>)) {
  (supabase.from as jest.Mock).mockImplementation(() => {
    const chain: any = {};
    chain.select = jest.fn(() => chain);
    chain.in = jest.fn(() => (typeof result === 'function' ? result() : Promise.resolve(result)));
    return chain;
  });
}

describe('killSwitches (P3.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetKillSwitchesForTests();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  it('defaults every switch to enabled', () => {
    expect(isFeatureEnabled('clips_upload')).toBe(true);
    expect(isFeatureEnabled('chat_send')).toBe(true);
    expect(isFeatureEnabled('games_realtime')).toBe(true);
    expect(isFeatureEnabled('presence')).toBe(true);
  });

  it('applyKillSwitchRows: only an explicit enabled=false (or an excluding window) switches off', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    const next = applyKillSwitchRows(
      [
        { key: 'chat_send', enabled: false },
        { key: 'games_realtime', enabled: true, end_date: '2026-09-25T11:00:00Z' },
        { key: 'presence', enabled: true, start_date: '2026-09-25T13:00:00Z' },
        { key: 'unrelated_flag', enabled: false },
      ],
      now,
    );
    expect(next).toEqual({
      clips_upload: true, // no row -> enabled
      chat_send: false,
      games_realtime: false, // window ended
      presence: false, // window not started
    });
  });

  it('refresh applies server rows and persists them; a fetch error keeps the current state', async () => {
    mockFlags({ data: [{ key: 'clips_upload', enabled: false }], error: null });
    await refreshKillSwitches();
    expect(isFeatureEnabled('clips_upload')).toBe(false);
    expect(isFeatureEnabled('chat_send')).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'killSwitches.v1',
      expect.stringContaining('"clips_upload":false'),
    );

    mockFlags({ data: null, error: { message: 'boom' } });
    await refreshKillSwitches();
    expect(isFeatureEnabled('clips_upload')).toBe(false);

    mockFlags(() => Promise.reject(new Error('network')));
    await refreshKillSwitches();
    expect(isFeatureEnabled('clips_upload')).toBe(false);

    // Row re-enabled (or deleted): back on.
    mockFlags({ data: [], error: null });
    await refreshKillSwitches();
    expect(isFeatureEnabled('clips_upload')).toBe(true);
  });

  it('init loads the last persisted state before the first fetch and polls every 5 minutes', async () => {
    jest.useFakeTimers();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ chat_send: false }));
    let calls = 0;
    mockFlags(() => {
      calls += 1;
      return Promise.resolve({ data: [], error: null });
    });
    initKillSwitches();
    // Persisted "off" is honoured immediately after the disk read.
    await Promise.resolve();
    await Promise.resolve();
    expect(isFeatureEnabled('chat_send')).toBe(false);
    // The first fetch (no rows) turns it back on.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(isFeatureEnabled('chat_send')).toBe(true);
    expect(calls).toBe(1);
    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(calls).toBe(2);
    jest.useRealTimers();
  });
});
