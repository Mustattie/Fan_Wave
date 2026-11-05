/**
 * Android store-capture finding, 2026-11-05 (native build 37).
 *
 * Every incoming message in a fan-group chat rendered its sender as
 * "Unknown". `app/fan-group/[id].tsx` fed raw `messages` rows to
 * `mapMessageToDisplay`, which reads `row.user.display_name` or
 * `row.user_name` -- neither present on a raw row.
 *
 * These tests drive the screen, not the mapper: a mapper fixture would
 * have passed throughout the bug's life, because the mapper was always
 * correct about the shape it was promised. What was wrong was what the
 * screen handed it, on four separate paths.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';

jest.setTimeout(30_000);

const ROOM_ID = 'room-1';
const ME = 'me';

const mockState = {
  messages: [] as any[],
  profiles: [] as Array<{ user_id: string; display_name: string | null }>,
  profilesError: null as any,
  /**
   * When set, get_public_profiles defers to this factory instead of
   * returning data. A factory, not a promise: a rejected promise built
   * at assignment time is unhandled until the call site reaches it, and
   * Node fails the run for that before the test can.
   */
  profilesPending: null as (() => Promise<any>) | null,
};
const rpcCalls: Array<{ name: string; args: any }> = [];

/** Captured realtime wiring so a test can deliver an INSERT itself. */
const realtime: { onInsert?: (row: any) => void } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'room-1' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const ReactLib = require('react');
    ReactLib.useEffect(cb, [cb]);
  },
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
jest.mock('expo-contacts', () => ({ Fields: { Name: 'name', PhoneNumbers: 'phoneNumbers' } }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  UIImagePickerControllerQualityType: { IFrame1280x720: 1 },
}));
jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));
jest.mock('@/lib/storage', () => ({
  uploadClip: jest.fn(),
  validateClip: jest.fn(),
  UploadValidationError: class extends Error {},
}));
jest.mock('@/lib/mediaContentType', () => ({
  getVideoContentType: () => 'video/mp4',
  getImageContentType: () => 'image/jpeg',
}));
jest.mock('@/components/ChatMediaPreview', () => ({
  __esModule: true,
  default: () => null,
  createChatPreviewMedia: jest.fn(),
}));
jest.mock('@/lib/inviteContacts', () => ({
  loadContactsWithPhones: jest.fn(async () => []),
  pickPhoneForContact: jest.fn(async () => null),
  openSmsInvite: jest.fn(async () => undefined),
  buildGroupInviteBody: jest.fn(() => 'invite'),
}));
jest.mock('@/lib/realtime', () => ({
  subscribeToMessages: jest.fn((_roomId: string, onInsert: (row: any) => void) => {
    realtime.onInsert = onInsert;
    return () => {};
  }),
  subscribeToPresence: jest.fn(() => () => {}),
  getRealtimeDiagnostics: jest.fn(() => ({ socketConnected: true })),
}));
jest.mock('@/lib/transientNetworkError', () => ({ shouldReportCatchUpError: jest.fn(() => false) }));
jest.mock('@/lib/groupMemberCount', () => ({
  fetchGroupMemberCount: jest.fn(async () => null),
  applyMemberCount: jest.fn((prev: any) => prev),
  presenceUserIds: jest.fn(() => []),
  presenceRosterChanged: jest.fn(() => false),
  becameActive: jest.fn(() => false),
}));
jest.mock('@/lib/killSwitches', () => ({ isFeatureEnabled: () => true }));
jest.mock('@/lib/errorReporting', () => ({ reportError: jest.fn(), addBreadcrumb: jest.fn() }));

function mockRespond(table: string) {
  if (table === 'chat_rooms') {
    return {
      data: {
        id: ROOM_ID,
        name: 'Mckinney Football Fanz',
        owner_id: 'someone-else',
        member_count: 6,
        visibility: 'public',
        group_type: 'sports',
      },
      error: null,
    };
  }
  if (table === 'chat_room_members') return { data: { user_id: ME }, error: null };
  if (table === 'messages') return { data: mockState.messages, error: null };
  if (table === 'match_moments') return { data: [], error: null };
  return { data: null, error: null };
}

function mockMakeBuilder(table: string) {
  const calls: any[] = [];
  const b: any = {};
  for (const m of ['select', 'insert', 'delete', 'update', 'eq', 'neq', 'gt', 'lt', 'order', 'limit', 'ilike', 'or']) {
    b[m] = (...args: any[]) => {
      calls.push([m, ...args]);
      return b;
    };
  }
  for (const m of ['single', 'maybeSingle']) {
    b[m] = () => Promise.resolve(mockRespond(table));
  }
  b.__calls = calls;
  b.then = (onOk: any, onErr: any) => Promise.resolve(mockRespond(table)).then(onOk, onErr);
  return b;
}

const selectArgsByTable: Record<string, string[]> = {};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const b = mockMakeBuilder(table);
      const origSelect = b.select;
      b.select = (...args: any[]) => {
        (selectArgsByTable[table] ||= []).push(String(args[0] ?? ''));
        return origSelect(...args);
      };
      return b;
    }),
    rpc: jest.fn((name: string, args: any) => {
      rpcCalls.push({ name, args });
      if (name === 'get_public_profiles') {
        if (mockState.profilesPending) return mockState.profilesPending();
        if (mockState.profilesError) {
          return Promise.resolve({ data: null, error: mockState.profilesError });
        }
        return Promise.resolve({ data: mockState.profiles, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    }),
  },
  getLocalUser: jest.fn(async () => ({
    data: { user: { id: ME, email: 'me@example.com', user_metadata: {} } },
    error: null,
  })),
}));

import FanGroupDetailScreen from '../app/fan-group/[id]';
import { __resetAuthorNameCache, __authorNameCacheSize } from '@/lib/chatAuthors';

function message(id: string, text: string, userId = 'other-1') {
  return {
    id,
    chat_room_id: ROOM_ID,
    user_id: userId,
    content: text,
    created_at: new Date('2026-11-05T12:00:00Z').toISOString(),
  };
}

beforeEach(() => {
  __resetAuthorNameCache();
  mockState.messages = [];
  mockState.profiles = [];
  mockState.profilesError = null;
  mockState.profilesPending = null;
  rpcCalls.length = 0;
  for (const k of Object.keys(selectArgsByTable)) delete selectArgsByTable[k];
  realtime.onInsert = undefined;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function renderGroup() {
  const utils = render(<FanGroupDetailScreen />);
  await waitFor(() => expect(utils.queryAllByText('Mckinney Football Fanz').length).toBeGreaterThan(0), {
    timeout: 5000,
  });
  return utils;
}

describe('initial load author names', () => {
  it('shows the real display name instead of "Unknown"', async () => {
    mockState.messages = [message('m1', 'first down')];
    mockState.profiles = [{ user_id: 'other-1', display_name: 'Priya Raman' }];

    const utils = await renderGroup();

    await waitFor(() => expect(utils.queryByText('first down')).toBeTruthy(), { timeout: 5000 });
    await waitFor(() => expect(utils.queryByText('Priya Raman')).toBeTruthy(), { timeout: 5000 });
    expect(utils.queryByText('Unknown')).toBeNull();
  });

  it('batches one lookup for many messages by the same author', async () => {
    mockState.messages = [
      message('m1', 'one', 'other-1'),
      message('m2', 'two', 'other-1'),
      message('m3', 'three', 'other-2'),
    ];
    mockState.profiles = [
      { user_id: 'other-1', display_name: 'Priya Raman' },
      { user_id: 'other-2', display_name: 'Dmitri Volkov' },
    ];

    const utils = await renderGroup();
    // Two messages share this author, so there are two name labels.
    await waitFor(() => expect(utils.queryAllByText('Priya Raman').length).toBe(2), { timeout: 5000 });
    expect(utils.queryAllByText('Dmitri Volkov').length).toBe(1);

    const profileCalls = rpcCalls.filter((c) => c.name === 'get_public_profiles');
    expect(profileCalls.length).toBe(1);
    // Distinct ids only -- three messages, two authors.
    expect(profileCalls[0].args.p_user_ids).toEqual(['other-1', 'other-2']);
  });

  it('keeps the mapper fallback when the profile lookup fails, and still renders the message', async () => {
    mockState.messages = [message('m1', 'lookup is down')];
    mockState.profilesError = { message: 'permission denied' };

    const utils = await renderGroup();

    // The point: the message survives. A name we could not resolve is a
    // cosmetic loss; a message we dropped is a product failure.
    await waitFor(() => expect(utils.queryByText('lookup is down')).toBeTruthy(), { timeout: 5000 });
    expect(utils.queryByText('Unknown')).toBeTruthy();
  });

  it('does not cache a name it never learned', async () => {
    mockState.messages = [message('m1', 'hello')];
    mockState.profilesError = { message: 'boom' };
    await renderGroup();
    await waitFor(() => expect(rpcCalls.some((c) => c.name === 'get_public_profiles')).toBe(true), {
      timeout: 5000,
    });
    expect(__authorNameCacheSize()).toBe(0);
  });
});

describe('incoming realtime messages', () => {
  it('hydrates the author of a message that arrives live', async () => {
    mockState.messages = [];
    mockState.profiles = [{ user_id: 'other-9', display_name: 'Dmitri Volkov' }];
    const utils = await renderGroup();
    await waitFor(() => expect(realtime.onInsert).toBeDefined(), { timeout: 5000 });

    await act(async () => {
      realtime.onInsert!(message('live-1', 'touchdown', 'other-9'));
    });

    await waitFor(() => expect(utils.queryByText('touchdown')).toBeTruthy(), { timeout: 5000 });
    await waitFor(() => expect(utils.queryByText('Dmitri Volkov')).toBeTruthy(), { timeout: 5000 });
    expect(utils.queryByText('Unknown')).toBeNull();
  });

  it('shows an incoming message immediately even while the name lookup hangs', async () => {
    let release: (v: any) => void = () => {};
    const pending = new Promise((res) => {
      release = res;
    });
    mockState.profilesPending = () => pending;
    const utils = await renderGroup();
    await waitFor(() => expect(realtime.onInsert).toBeDefined(), { timeout: 5000 });

    await act(async () => {
      realtime.onInsert!(message('live-2', 'do not block me', 'other-9'));
    });

    // Rendered without waiting on the pending RPC: the bubble is not
    // gated on the name, which is the whole point of patching after.
    await waitFor(() => expect(utils.queryByText('do not block me')).toBeTruthy(), { timeout: 5000 });
    expect(utils.queryByText('Unknown')).toBeTruthy();

    await act(async () => {
      release({ data: [{ user_id: 'other-9', display_name: 'Dmitri Volkov' }], error: null });
      await Promise.resolve();
    });
    await waitFor(() => expect(utils.queryByText('Dmitri Volkov')).toBeTruthy(), { timeout: 5000 });
  });

  it('keeps the message when the live name lookup rejects', async () => {
    mockState.profilesPending = () => Promise.reject(new Error('socket closed'));
    const utils = await renderGroup();
    await waitFor(() => expect(realtime.onInsert).toBeDefined(), { timeout: 5000 });

    await act(async () => {
      realtime.onInsert!(message('live-3', 'survives a throw', 'other-9'));
      await Promise.resolve();
    });

    await waitFor(() => expect(utils.queryByText('survives a throw')).toBeTruthy(), { timeout: 5000 });
  });

  it('does not duplicate a message delivered twice', async () => {
    mockState.profiles = [{ user_id: 'other-9', display_name: 'Dmitri Volkov' }];
    const utils = await renderGroup();
    await waitFor(() => expect(realtime.onInsert).toBeDefined(), { timeout: 5000 });

    const row = message('live-dup', 'said once', 'other-9');
    await act(async () => {
      realtime.onInsert!(row);
      realtime.onInsert!(row);
    });

    await waitFor(() => expect(utils.queryAllByText('said once').length).toBe(1), { timeout: 5000 });
    // And hydration must not fan the single bubble into two.
    await waitFor(() => expect(utils.queryAllByText('Dmitri Volkov').length).toBe(1), { timeout: 5000 });
  });

  it('reuses the cached name rather than re-querying per message', async () => {
    mockState.messages = [message('m1', 'first', 'other-1')];
    mockState.profiles = [{ user_id: 'other-1', display_name: 'Priya Raman' }];
    const utils = await renderGroup();
    await waitFor(() => expect(utils.queryByText('Priya Raman')).toBeTruthy(), { timeout: 5000 });
    const afterInitial = rpcCalls.filter((c) => c.name === 'get_public_profiles').length;

    await act(async () => {
      realtime.onInsert!(message('live-4', 'second', 'other-1'));
    });
    await waitFor(() => expect(utils.queryByText('second')).toBeTruthy(), { timeout: 5000 });

    expect(rpcCalls.filter((c) => c.name === 'get_public_profiles').length).toBe(afterInitial);
  });
});

describe('privacy', () => {
  it('no longer joins whole user rows anywhere in the chat screen', async () => {
    mockState.messages = [message('m1', 'hi')];
    mockState.profiles = [{ user_id: 'other-1', display_name: 'Priya Raman' }];
    await renderGroup();
    await waitFor(() => expect(rpcCalls.some((c) => c.name === 'get_public_profiles')).toBe(true), {
      timeout: 5000,
    });

    // The pagination path used `*, user:users!user_id(*)`, which selects
    // email alongside the display name. Names come from the public
    // projection now, so no select should reach into `users`.
    const selects = Object.values(selectArgsByTable).flat();
    expect(selects.some((s) => s.includes('users'))).toBe(false);
  });
});
