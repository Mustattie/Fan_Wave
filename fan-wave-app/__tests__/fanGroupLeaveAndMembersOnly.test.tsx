/**
 * iOS UAT 2026-10-15.
 *
 * SKYC-130: joining a fan group was one tap and permanent -- there was no
 * Leave action anywhere in the app. The server does allow it
 * (chat_room_members_delete, mig 051, permits `user_id = auth.uid()`),
 * but that same policy would also let the creator delete their own
 * membership and leave the group ownerless, and there is no
 * ownership-transfer RPC to hand it over first. So: members can leave,
 * the creator is refused and told why.
 *
 * SKYC-143: messages_select is member-gated (mig 051), so a non-member's
 * query returns zero rows however busy the group is -- and the screen
 * rendered "No messages yet — start the conversation!", which is both
 * false and an invitation to do the one thing RLS will refuse.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';

jest.setTimeout(30_000);

const ROOM_ID = 'room-1';
const ME = 'me';

// Per-test switches for the fixture below.
const mockState = {
  ownerId: 'someone-else',
  isMember: true,
  messages: [] as any[],
  deleteError: null as any,
  deleteRows: true,
};
const mockDeleteCalls: any[] = [];

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
jest.mock('expo-contacts', () => ({
  Fields: { Name: 'name', PhoneNumbers: 'phoneNumbers' },
}));
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
  subscribeToMessages: jest.fn(() => () => {}),
  subscribeToPresence: jest.fn(() => () => {}),
  getRealtimeDiagnostics: jest.fn(() => ({ socketConnected: true })),
}));
jest.mock('@/lib/transientNetworkError', () => ({
  shouldReportCatchUpError: jest.fn(() => false),
}));
jest.mock('@/lib/groupMemberCount', () => ({
  fetchGroupMemberCount: jest.fn(async () => null),
  applyMemberCount: jest.fn((prev: any) => prev),
  presenceUserIds: jest.fn(() => []),
  presenceRosterChanged: jest.fn(() => false),
  becameActive: jest.fn(() => false),
}));
jest.mock('@/lib/killSwitches', () => ({ isFeatureEnabled: () => true }));
jest.mock('@/lib/errorReporting', () => ({
  reportError: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

function mockRespond(table: string, calls: any[]) {
  const isDelete = calls.some((c) => c[0] === 'delete');
  if (table === 'chat_rooms') {
    return {
      data: {
        id: 'room-1',
        name: 'Mckinney Football Fanz',
        owner_id: mockState.ownerId,
        member_count: 6,
        visibility: 'public',
        group_type: 'sports',
      },
      error: null,
    };
  }
  if (table === 'chat_room_members') {
    if (isDelete) {
      mockDeleteCalls.push(calls);
      return { data: mockState.deleteError ? null : mockState.deleteRows ? [{ user_id: ME }] : [], error: mockState.deleteError };
    }
    return { data: mockState.isMember ? { user_id: ME } : null, error: null };
  }
  if (table === 'messages') {
    // Member-gated server-side: a non-member's query comes back empty.
    return { data: mockState.isMember ? mockState.messages : [], error: null };
  }
  if (table === 'match_moments') return { data: [], error: null };
  return { data: null, error: null };
}

function mockMakeBuilder(table: string) {
  const calls: any[] = [];
  const b: any = {};
  for (const m of [
    'select', 'insert', 'delete', 'update', 'eq', 'neq', 'gt', 'lt', 'order', 'limit', 'ilike', 'or',
  ]) {
    b[m] = (...args: any[]) => {
      calls.push([m, ...args]);
      return b;
    };
  }
  for (const m of ['single', 'maybeSingle']) {
    b[m] = (...args: any[]) => {
      calls.push([m, ...args]);
      return Promise.resolve(mockRespond(table, calls));
    };
  }
  b.then = (onOk: any, onErr: any) =>
    Promise.resolve(mockRespond(table, calls)).then(onOk, onErr);
  return b;
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => mockMakeBuilder(table)),
    rpc: jest.fn(async () => ({ data: true, error: null })),
  },
  getLocalUser: jest.fn(async () => ({
    data: { user: { id: 'me', email: 'me@example.com', user_metadata: {} } },
    error: null,
  })),
}));

import FanGroupDetailScreen from '../app/fan-group/[id]';

const MEMBERS_ONLY = /conversation is visible to members/;
const BROWSE_EMPTY = 'No messages yet — start the conversation!';

function message(id: string, text: string) {
  return {
    id,
    chat_room_id: ROOM_ID,
    user_id: 'other',
    content: text,
    created_at: new Date('2026-10-15T12:00:00Z').toISOString(),
  };
}

beforeEach(() => {
  mockState.ownerId = 'someone-else';
  mockState.isMember = true;
  mockState.messages = [];
  mockState.deleteError = null;
  mockState.deleteRows = true;
  mockDeleteCalls.length = 0;
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

describe('members-only empty state (SKYC-143)', () => {
  it('does not tell a non-member the group is empty', async () => {
    mockState.isMember = false;
    const utils = await renderGroup();

    await waitFor(() => expect(utils.queryByText('Members only')).toBeTruthy(), {
      timeout: 5000,
    });
    expect(utils.queryByText(MEMBERS_ONLY)).toBeTruthy();
    expect(utils.queryByText(BROWSE_EMPTY)).toBeNull();
    // The composer already routes to the fix; the empty state names it.
    expect(utils.queryByText(/Join to read along and post/)).toBeTruthy();
  });

  it('still says "no messages yet" to a member who can actually read them', async () => {
    mockState.isMember = true;
    const utils = await renderGroup();

    await waitFor(() => expect(utils.queryByText(BROWSE_EMPTY)).toBeTruthy(), {
      timeout: 5000,
    });
    expect(utils.queryByText('Members only')).toBeNull();
  });

  it('says nothing about emptiness before membership is known', async () => {
    // First paint, before the membership query resolves: neither claim is
    // supported yet, so neither is made.
    mockState.isMember = false;
    const utils = render(<FanGroupDetailScreen />);
    expect(utils.queryByText(BROWSE_EMPTY)).toBeNull();
    expect(utils.queryByText('Members only')).toBeNull();
    await waitFor(() => expect(utils.queryByText('Members only')).toBeTruthy(), {
      timeout: 5000,
    });
  });
});

describe('leave group (SKYC-130)', () => {
  it('does not claim a leave when RLS returns no deleted row', async () => {
    mockState.deleteRows = false;
    const utils = await renderGroup();
    const leave = await waitFor(() => utils.getByLabelText('Leave group'));
    fireEvent.press(leave);
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    await act(async () => { buttons.find((b: any) => b.text === 'Leave').onPress(); });
    await waitFor(() => expect((Alert.alert as jest.Mock).mock.calls.some(c => c[0] === 'Could not leave')).toBe(true));
    expect(utils.queryByLabelText('Leave group')).toBeTruthy();
  });
  it('offers Leave to a member and confirms before acting', async () => {
    const utils = await renderGroup();
    const leave = await waitFor(() => utils.getByLabelText('Leave group'), {
      timeout: 5000,
    });

    fireEvent.press(leave);

    expect(Alert.alert).toHaveBeenCalled();
    const [title, body, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('Leave group?');
    expect(body).toMatch(/Mckinney Football Fanz/);
    const leaveBtn = (buttons as any[]).find((b) => b.text === 'Leave');
    expect(leaveBtn.style).toBe('destructive');
    expect((buttons as any[]).some((b) => b.text === 'Cancel')).toBe(true);
    // Nothing happened on the confirm alone.
    expect(mockDeleteCalls).toHaveLength(0);
  });

  it('deletes only the current user\'s own membership row', async () => {
    const utils = await renderGroup();
    const leave = await waitFor(() => utils.getByLabelText('Leave group'), {
      timeout: 5000,
    });
    fireEvent.press(leave);
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];

    await act(async () => { (buttons as any[]).find((b) => b.text === 'Leave').onPress(); });

    await waitFor(() => expect(mockDeleteCalls).toHaveLength(1));
    const calls = mockDeleteCalls[0].map((c: any[]) => c.join(':'));
    // Scoped to this room AND this user -- the policy allows nothing
    // wider, and a missing filter would be a mass delete attempt.
    expect(calls).toContain('eq:chat_room_id:room-1');
    expect(calls).toContain('eq:user_id:me');
  });

  it('drops the thread and the composer after leaving, since reads are gated', async () => {
    mockState.messages = [message('m-1', 'Go Fanz')];
    const utils = await renderGroup();
    await waitFor(() => expect(utils.queryByText('Go Fanz')).toBeTruthy(), {
      timeout: 5000,
    });

    fireEvent.press(utils.getByLabelText('Leave group'));
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    await act(async () => { (buttons as any[]).find((b) => b.text === 'Leave').onPress(); });

    await waitFor(() => expect(utils.queryByText('Go Fanz')).toBeNull(), {
      timeout: 5000,
    });
    // Back to the non-member surface: the composer states the
    // requirement instead of inviting a write RLS would refuse.
    expect(
      utils.queryByText('Join this group to join the conversation'),
    ).toBeTruthy();
    expect(utils.queryByText('Members only')).toBeTruthy();
  });

  it('refuses to orphan a group: the creator cannot leave', async () => {
    mockState.ownerId = ME;
    const utils = await renderGroup();
    const leave = await waitFor(() => utils.getByLabelText('Leave group'), {
      timeout: 5000,
    });

    fireEvent.press(leave);

    const [title, body, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('You created this group');
    expect(body).toMatch(/without an owner/);
    // No destructive option is offered at all, and nothing is deleted --
    // not even if the alert's only button is tapped.
    expect((buttons as any[]).every((b) => b.style !== 'destructive')).toBe(true);
    expect(mockDeleteCalls).toHaveLength(0);
  });

  it('does not offer Leave to someone who has not joined', async () => {
    mockState.isMember = false;
    const utils = await renderGroup();
    await waitFor(() => expect(utils.queryByText('Members only')).toBeTruthy(), {
      timeout: 5000,
    });
    expect(utils.queryByLabelText('Leave group')).toBeNull();
  });

  it('keeps the user in the group when the delete fails', async () => {
    mockState.deleteError = { message: 'network down' };
    mockState.messages = [message('m-1', 'Go Fanz')];
    const utils = await renderGroup();
    await waitFor(() => expect(utils.queryByText('Go Fanz')).toBeTruthy(), {
      timeout: 5000,
    });

    fireEvent.press(utils.getByLabelText('Leave group'));
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    await act(async () => { (buttons as any[]).find((b) => b.text === 'Leave').onPress(); });

    await waitFor(() =>
      expect(
        (Alert.alert as jest.Mock).mock.calls.some((c) => c[0] === 'Could not leave'),
      ).toBe(true),
    );
    // Still a member on screen: the thread is intact and the composer is live.
    expect(utils.queryByText('Go Fanz')).toBeTruthy();
    expect(utils.queryByText('Members only')).toBeNull();
  });
});
