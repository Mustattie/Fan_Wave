// Maps Supabase auth errors to user-facing messages.
//
// Supabase v2 returns AuthApiError objects with a stable `code` for many
// failure modes; we prefer that when available and fall back to message
// matching for older error shapes. Everything else is reported as a generic
// network error so we never leak raw Supabase strings to the UI.

export type AuthErrorKind =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'email_already_registered'
  | 'weak_password'
  | 'rate_limited'
  | 'invalid_email'
  | 'network'
  | 'unknown';

export type AuthErrorInfo = {
  kind: AuthErrorKind;
  title: string;
  message: string;
};

export function parseAuthError(error: unknown): AuthErrorInfo {
  const code = (error as { code?: string } | null)?.code;
  const status = (error as { status?: number } | null)?.status;
  const rawMessage =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message ?? '')
      : '';
  const msg = rawMessage.toLowerCase();

  // Prefer structured code when present
  switch (code) {
    case 'invalid_credentials':
      return {
        kind: 'invalid_credentials',
        title: 'Sign In Failed',
        message: 'Incorrect email or password. Please try again.',
      };
    case 'email_not_confirmed':
      return {
        kind: 'email_not_confirmed',
        title: 'Confirm your email',
        message:
          'Check your inbox for a confirmation link before signing in. You can request a new one from the sign-in screen.',
      };
    case 'user_already_exists':
    case 'email_exists':
      return {
        kind: 'email_already_registered',
        title: 'Email already in use',
        message:
          'An account with this email already exists. Try signing in, or use Forgot Password if you do not remember your password.',
      };
    case 'weak_password':
      return {
        kind: 'weak_password',
        title: 'Weak password',
        message: 'Please choose a stronger password (at least 8 characters with a mix of letters and numbers).',
      };
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return {
        kind: 'rate_limited',
        title: 'Too many attempts',
        message: 'You have tried too many times. Please wait a minute and try again.',
      };
    case 'validation_failed':
      return {
        kind: 'invalid_email',
        title: 'Invalid email',
        message: 'That email address does not look right. Please check and try again.',
      };
  }

  // Fall back to message matching for older error shapes
  if (msg.includes('invalid login credentials')) {
    return {
      kind: 'invalid_credentials',
      title: 'Sign In Failed',
      message: 'Incorrect email or password. Please try again.',
    };
  }
  if (msg.includes('email not confirmed')) {
    return {
      kind: 'email_not_confirmed',
      title: 'Confirm your email',
      message: 'Check your inbox for a confirmation link before signing in.',
    };
  }
  if (msg.includes('already registered') || msg.includes('already exists')) {
    return {
      kind: 'email_already_registered',
      title: 'Email already in use',
      message:
        'An account with this email already exists. Try signing in, or use Forgot Password if you do not remember your password.',
    };
  }
  if (msg.includes('rate limit')) {
    return {
      kind: 'rate_limited',
      title: 'Too many attempts',
      message: 'You have tried too many times. Please wait a minute and try again.',
    };
  }
  if (msg.includes('password')) {
    return {
      kind: 'weak_password',
      title: 'Weak password',
      message: 'Please choose a stronger password (at least 8 characters).',
    };
  }

  // 4xx with no specific code → likely a server-side validation we did not anticipate.
  // 5xx or no status → treat as network / transient.
  if (status && status >= 400 && status < 500) {
    return {
      kind: 'unknown',
      title: 'Something went wrong',
      message: 'We could not complete that request. Please try again.',
    };
  }

  return {
    kind: 'network',
    title: 'Connection problem',
    message: 'Could not reach Fan Wave. Please check your internet connection and try again.',
  };
}
