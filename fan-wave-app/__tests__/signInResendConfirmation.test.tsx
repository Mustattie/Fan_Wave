/**
 * iOS UAT 2026-10-15 (SKYC-136): signing in with an unconfirmed address
 * showed "Check your inbox for a confirmation link before signing in. You
 * can request a new one from the sign-in screen." — and the sign-in
 * screen had no such control. The only resend lived on the branch where
 * Supabase returns a session for an unconfirmed user; with Confirm Email
 * enabled, signInWithPassword returns an error and no session, which fell
 * through to the generic catch and just printed that message.
 */
import React from 'react';

jest.setTimeout(30_000);
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('lucide-react-native', () => {
  const stub = () => null;
  return new Proxy({}, { get: () => stub });
});
jest.mock('@/lib/authTelemetry', () => ({ markIntentionalSignOut: jest.fn() }));
jest.mock('@/lib/authRedirect', () => ({ AUTH_REDIRECT_URL: 'fansphere://auth' }));
jest.mock('@/components/KeyboardAwareScreen', () => ({
  KeyboardAwareScreen: ({ children }: any) => {
    const ReactLib = require('react');
    const { View } = require('react-native');
    return ReactLib.createElement(View, null, children);
  },
}));

const mockSignIn = jest.fn();
const mockResend = jest.fn();
// Rest parameter so the spread at the call site below type-checks:
// jest.fn(async () => …) is a zero-arity signature and TS2556s on (...a).
const mockSignOut = jest.fn(async (..._args: any[]) => ({ error: null }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...a: any[]) => mockSignIn(...a),
      resend: (...a: any[]) => mockResend(...a),
      signOut: (...a: any[]) => mockSignOut(...a),
    },
  },
  getLocalUser: jest.fn(async () => ({ data: { user: null }, error: null })),
}));

import SignInScreen from '../app/(auth)/sign-in';
import { parseAuthError } from '../lib/authErrors';

const EMAIL = 'fan@example.com';

function unconfirmedError() {
  return Object.assign(new Error('Email not confirmed'), {
    code: 'email_not_confirmed',
    status: 400,
  });
}

async function signIn(utils: ReturnType<typeof render>) {
  fireEvent.changeText(utils.getByPlaceholderText('Email'), EMAIL);
  fireEvent.changeText(utils.getByPlaceholderText('Password'), 'hunter2!');
  await act(async () => { fireEvent.press(utils.getByText('Sign In')); });
}

beforeEach(() => {
  mockSignIn.mockReset();
  mockResend.mockReset();
  mockResend.mockResolvedValue({ error: null });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('parseAuthError email_not_confirmed (SKYC-136)', () => {
  it('flags the remedy as an action the UI must render', () => {
    const fromCode = parseAuthError({ code: 'email_not_confirmed' });
    expect(fromCode.kind).toBe('email_not_confirmed');
    expect(fromCode.action).toBe('resend_confirmation');

    // Older error shapes reach the same place, with the same action.
    const fromMessage = parseAuthError(new Error('Email not confirmed'));
    expect(fromMessage.kind).toBe('email_not_confirmed');
    expect(fromMessage.action).toBe('resend_confirmation');
  });

  it('no longer points at a control that does not exist', () => {
    const info = parseAuthError({ code: 'email_not_confirmed' });
    expect(info.message).not.toMatch(/from the sign-in screen/i);
  });

  it('leaves other failures without an action', () => {
    expect(parseAuthError({ code: 'invalid_credentials' }).action).toBeUndefined();
    expect(parseAuthError(new Error('network down')).action).toBeUndefined();
  });
});

describe('sign-in resend (SKYC-136)', () => {
  it('offers a resend when sign-in fails with email_not_confirmed', async () => {
    mockSignIn.mockRejectedValue(unconfirmedError());
    const utils = render(<SignInScreen />);
    await signIn(utils);

    // The alert carries a real button, not just prose...
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [title, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe('Confirm your email');
    expect(message).toMatch(/send a new one/i);
    expect((buttons as any[]).map((b) => b.text)).toContain('Resend link');

    // ...and the control stays on the screen after the alert is gone.
    await waitFor(() =>
      expect(utils.queryByText('Resend confirmation email')).toBeTruthy(),
    );
    expect(utils.queryByText(`${EMAIL} still needs to be confirmed.`)).toBeTruthy();
  });

  it('actually resends to the address that was attempted', async () => {
    mockSignIn.mockRejectedValue(unconfirmedError());
    const utils = render(<SignInScreen />);
    await signIn(utils);
    await waitFor(() =>
      expect(utils.queryByText('Resend confirmation email')).toBeTruthy(),
    );

    fireEvent.press(utils.getByText('Resend confirmation email'));
    await waitFor(() => expect(mockResend).toHaveBeenCalledTimes(1));
    expect(mockResend).toHaveBeenCalledWith({
      type: 'signup',
      email: EMAIL,
      options: { emailRedirectTo: 'fansphere://auth' },
    });
  });

  it('also covers the session-without-confirmation branch', async () => {
    mockSignIn.mockResolvedValue({
      data: { session: { user: { email_confirmed_at: null } } },
      error: null,
    });
    const utils = render(<SignInScreen />);
    await signIn(utils);

    await waitFor(() =>
      expect(utils.queryByText('Resend confirmation email')).toBeTruthy(),
    );
    fireEvent.press(utils.getByText('Resend confirmation email'));
    await waitFor(() => expect(mockResend).toHaveBeenCalledTimes(1));
  });

  it('withdraws the resend row when the address is edited', async () => {
    mockSignIn.mockRejectedValue(unconfirmedError());
    const utils = render(<SignInScreen />);
    await signIn(utils);
    await waitFor(() =>
      expect(utils.queryByText('Resend confirmation email')).toBeTruthy(),
    );

    fireEvent.changeText(utils.getByPlaceholderText('Email'), 'someone.else@example.com');
    expect(utils.queryByText('Resend confirmation email')).toBeNull();
  });

  it('does not offer a resend for a wrong password', async () => {
    mockSignIn.mockRejectedValue(
      Object.assign(new Error('Invalid login credentials'), {
        code: 'invalid_credentials',
        status: 400,
      }),
    );
    const utils = render(<SignInScreen />);
    await signIn(utils);

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(utils.queryByText('Resend confirmation email')).toBeNull();
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(buttons).toBeUndefined();
  });
});
