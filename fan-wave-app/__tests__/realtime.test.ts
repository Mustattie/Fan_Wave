// Reference-counted channel registry (lib/realtime.ts).
//
// The fake client below mirrors the two realtime-js behaviours the bug
// depends on: channel(topic) returns the existing channel for a topic, and
// removeChannel() is what actually tears it down.

type StatusCb = (status: string, err?: Error) => void;

interface FakeChannel {
  topic: string;
  bindings: Array<{ filter: any; cb: (p: any) => void }>;
  statusCb: StatusCb | null;
  on: jest.Mock;
  subscribe: jest.Mock;
}

const mockChannels = new Map<string, FakeChannel>();
const mockRemoveChannel = jest.fn((ch: FakeChannel) => {
  mockChannels.delete(ch.topic);
  ch.statusCb?.('CLOSED');
});

function mockMakeChannel(topic: string): FakeChannel {
  const ch: FakeChannel = {
    topic: `realtime:${topic}`,
    bindings: [],
    statusCb: null,
    on: jest.fn(),
    subscribe: jest.fn(),
  };
  ch.on.mockImplementation((_type: string, filter: any, cb: (p: any) => void) => {
    ch.bindings.push({ filter, cb });
    return ch;
  });
  ch.subscribe.mockImplementation((cb?: StatusCb) => {
    ch.statusCb = cb ?? null;
    return ch;
  });
  return ch;
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: jest.fn((topic: string) => {
      const key = `realtime:${topic}`;
      const existing = mockChannels.get(key);
      if (existing) return existing;
      const ch = mockMakeChannel(topic);
      mockChannels.set(key, ch);
      return ch;
    }),
    removeChannel: (ch: FakeChannel) => mockRemoveChannel(ch),
    getChannels: () => Array.from(mockChannels.values()),
    realtime: { isConnected: () => true },
  },
}));

jest.mock('@/lib/errorReporting', () => ({
  reportError: jest.fn(),
  reportMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

import {
  subscribeToTable,
  subscribeToGames,
  getRealtimeDiagnostics,
  _resetRealtimeRegistryForTests,
} from '../lib/realtime';
import { reportMessage, addBreadcrumb } from '../lib/errorReporting';

function liveChannel(topic: string): FakeChannel {
  const ch = mockChannels.get(`realtime:${topic}`);
  if (!ch) throw new Error(`no channel ${topic}`);
  return ch;
}

describe('realtime registry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockChannels.clear();
    mockRemoveChannel.mockClear();
    (reportMessage as jest.Mock).mockClear();
    _resetRealtimeRegistryForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens one channel for two subscribers of the same topic', () => {
    const a = jest.fn();
    const b = jest.fn();
    subscribeToGames(a);
    subscribeToGames(b);

    expect(mockChannels.size).toBe(1);
    const ch = liveChannel('games-realtime');
    expect(ch.subscribe).toHaveBeenCalledTimes(1);
    expect(ch.bindings).toHaveLength(1);

    ch.bindings[0]!.cb({ new: { id: 'g1' } });
    expect(a).toHaveBeenCalledWith({ id: 'g1' });
    expect(b).toHaveBeenCalledWith({ id: 'g1' });
  });

  it('does not remove the channel while another subscriber still needs it', () => {
    const root = jest.fn();
    const screen = jest.fn();
    subscribeToGames(root);
    const leaveScreen = subscribeToGames(screen);

    leaveScreen();
    jest.advanceTimersByTime(1_000);

    expect(mockRemoveChannel).not.toHaveBeenCalled();
    liveChannel('games-realtime').bindings[0]!.cb({ new: { id: 'g2' } });
    expect(root).toHaveBeenCalledWith({ id: 'g2' });
    expect(screen).not.toHaveBeenCalled();
    expect(getRealtimeDiagnostics().topics[0]).toMatchObject({
      topic: 'games-realtime',
      subscribers: 1,
    });
  });

  it('removes the channel after the last subscriber leaves, after a grace period', () => {
    const leaveA = subscribeToGames(jest.fn());
    const leaveB = subscribeToGames(jest.fn());
    leaveA();
    leaveB();

    expect(mockRemoveChannel).not.toHaveBeenCalled();
    jest.advanceTimersByTime(400);
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    expect(getRealtimeDiagnostics().topics).toHaveLength(0);
    // Our own teardown's CLOSED is not reported as unexpected.
    expect(reportMessage).not.toHaveBeenCalled();
  });

  it('keeps the channel when a subscriber returns inside the grace period', () => {
    const leave = subscribeToGames(jest.fn());
    leave();
    jest.advanceTimersByTime(100);
    subscribeToGames(jest.fn());
    jest.advanceTimersByTime(1_000);
    expect(mockRemoveChannel).not.toHaveBeenCalled();
    expect(mockChannels.size).toBe(1);
  });

  it('gives a same-named subscription with a different shape its own channel', () => {
    subscribeToTable('shared', 'games', 'UPDATE', jest.fn());
    subscribeToTable('shared', 'games', 'INSERT', jest.fn());
    expect(mockChannels.size).toBe(2);
    const topics = getRealtimeDiagnostics().topics.map((t) => t.topic);
    expect(topics).toContain('shared');
    expect(topics.some((t) => t.startsWith('shared:'))).toBe(true);
  });

  it('reports a rejected initial join at once, named by topic, once per minute', () => {
    subscribeToGames(jest.fn());
    const ch = liveChannel('games-realtime');
    ch.statusCb?.('CHANNEL_ERROR', new Error('boom'));
    ch.statusCb?.('CHANNEL_ERROR', new Error('boom again'));
    ch.statusCb?.('TIMED_OUT');
    expect(reportMessage).toHaveBeenCalledTimes(1);
    expect(reportMessage).toHaveBeenCalledWith(
      'realtime.join_rejected [games-realtime]',
      'warning',
      expect.objectContaining({
        topic: 'games-realtime',
        phase: 'initial-join',
        errors: 1,
        detail: 'CHANNEL_ERROR: boom',
      }),
      expect.objectContaining({ realtime_topic: 'games-realtime', realtime_table: 'games' }),
    );
    expect(getRealtimeDiagnostics().topics[0]!.errors).toBe(3);
  });

  it('treats a post-join CHANNEL_ERROR as a reconnect: breadcrumb only, warning only if no rejoin in 60 s', () => {
    subscribeToGames(jest.fn());
    const ch = liveChannel('games-realtime');
    ch.statusCb?.('SUBSCRIBED');
    (addBreadcrumb as jest.Mock).mockClear();

    // Socket drop: Phoenix errors every joined channel.
    ch.statusCb?.('CHANNEL_ERROR', new Error('socket closed'));
    expect(reportMessage).not.toHaveBeenCalled();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      'realtime',
      'channel_error.after_join',
      expect.objectContaining({ topic: 'games-realtime', status: 'CHANNEL_ERROR' }),
    );

    // Rejoined in time: the watchdog is cancelled, nothing reported.
    jest.advanceTimersByTime(30_000);
    ch.statusCb?.('SUBSCRIBED');
    jest.advanceTimersByTime(60_000);
    expect(reportMessage).not.toHaveBeenCalled();
    expect(getRealtimeDiagnostics().topics[0]!.rejoins).toBe(1);

    // Dropped again and never comes back: one warning after 60 s.
    ch.statusCb?.('CHANNEL_ERROR', new Error('socket closed'));
    jest.advanceTimersByTime(59_000);
    expect(reportMessage).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2_000);
    expect(reportMessage).toHaveBeenCalledTimes(1);
    expect(reportMessage).toHaveBeenCalledWith(
      'realtime.rejoin_failed [games-realtime]',
      'warning',
      expect.objectContaining({ phase: 'after-join' }),
      expect.anything(),
    );
  });

  it('notifies onReconnect on a re-join but not on the first join', () => {
    const onReconnect = jest.fn();
    subscribeToGames(jest.fn(), onReconnect);
    const ch = liveChannel('games-realtime');

    ch.statusCb?.('SUBSCRIBED');
    expect(onReconnect).not.toHaveBeenCalled();

    ch.statusCb?.('CHANNEL_ERROR');
    ch.statusCb?.('SUBSCRIBED');
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(getRealtimeDiagnostics().topics[0]!.rejoins).toBe(1);
  });

  it('re-opens a channel the server closed unexpectedly', () => {
    subscribeToGames(jest.fn());
    const first = liveChannel('games-realtime');
    first.statusCb?.('SUBSCRIBED');

    // Server-side close while we still have a subscriber.
    mockChannels.delete(first.topic);
    first.statusCb?.('CLOSED');
    expect(reportMessage).toHaveBeenCalledWith(
      'realtime.closed_unexpectedly [games-realtime]',
      'warning',
      expect.anything(),
      expect.anything(),
    );

    jest.advanceTimersByTime(2_100);
    const second = liveChannel('games-realtime');
    expect(second).not.toBe(first);
    expect(second.subscribe).toHaveBeenCalledTimes(1);

    // The stale channel's late status is ignored.
    first.statusCb?.('SUBSCRIBED');
    expect(getRealtimeDiagnostics().topics[0]!.status).toBe('pending');
  });

  it('is idempotent on double-unsubscribe', () => {
    subscribeToGames(jest.fn());
    const leave = subscribeToGames(jest.fn());
    leave();
    leave();
    jest.advanceTimersByTime(1_000);
    expect(getRealtimeDiagnostics().topics[0]!.subscribers).toBe(1);
    expect(mockRemoveChannel).not.toHaveBeenCalled();
  });
});

describe('watchPartyMatchesCity', () => {
  const { watchPartyMatchesCity } = require('../lib/realtime');
  it('matches on the first comma segment, case-insensitively', () => {
    expect(watchPartyMatchesCity({ venue_metro: 'Dallas' }, 'Dallas')).toBe(true);
    expect(watchPartyMatchesCity({ venue_metro: 'McKinney' }, 'McKinney, Texas')).toBe(true);
    expect(watchPartyMatchesCity({ venue_metro: 'dallas' }, 'DALLAS')).toBe(true);
  });
  it('rejects other metros and empty input', () => {
    expect(watchPartyMatchesCity({ venue_metro: 'Prosper' }, 'Dallas')).toBe(false);
    expect(watchPartyMatchesCity({ venue_metro: null }, 'Dallas')).toBe(false);
    expect(watchPartyMatchesCity({ venue_metro: 'Dallas' }, '')).toBe(false);
  });
});
