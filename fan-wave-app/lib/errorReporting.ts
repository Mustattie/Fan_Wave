// Centralised error reporting wrapper.
//
// Sentry's native module is unavailable in Expo Go (it requires a custom dev
// build via `eas build --profile development`). To keep the same call sites
// working in both Expo Go and EAS builds, this module lazy-loads Sentry and
// degrades to a console log when the native module isn't present.
//
// Public surface:
//   initErrorReporting()       — call once at app startup (in _layout.tsx)
//   reportError(error, ctx?)   — report a caught exception
//   reportMessage(msg, level?) — report a non-exception warning/info
//   setUserContext({...})      — tag subsequent reports with the user
//   clearUserContext()         — clear after sign-out

type Sentry = typeof import('@sentry/react-native');

let sentry: Sentry | null = null;
let initialised = false;

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';
const ENV = process.env.APP_ENV || (process.env.NODE_ENV ?? 'development');

export function initErrorReporting(): void {
  if (initialised) return;
  initialised = true;

  if (!DSN || DSN.startsWith('YOUR_')) {
    if (__DEV__) {
      console.log('[errorReporting] No Sentry DSN — using console fallback.');
    }
    return;
  }

  try {
    // Dynamic require so Expo Go (no native module) doesn't crash on import.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sentry = require('@sentry/react-native') as Sentry;
    sentry.init({
      dsn: DSN,
      environment: ENV,
      tracesSampleRate: ENV === 'production' ? 0.1 : 0.5,
      enableAutoSessionTracking: true,
      enabled: !__DEV__,
    });
  } catch (e) {
    if (__DEV__) {
      console.log('[errorReporting] Sentry native module unavailable, falling back to console.', e);
    }
    sentry = null;
  }
}

type Context = Record<string, unknown> | undefined;

export function reportError(error: unknown, context?: Context): void {
  if (sentry) {
    sentry.captureException(error, context ? { extra: context } : undefined);
    return;
  }
  // Fallback: log to console with context so devs can still see what failed.
  const message = error instanceof Error ? error.message : String(error);
  if (context) {
    console.warn('[reportError]', message, context);
  } else {
    console.warn('[reportError]', message);
  }
}

export function reportMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  context?: Context,
): void {
  if (sentry) {
    sentry.captureMessage(message, { level, extra: context });
    return;
  }
  if (level === 'error') {
    console.error('[reportMessage]', message, context ?? '');
  } else if (level === 'warning') {
    console.warn('[reportMessage]', message, context ?? '');
  } else if (__DEV__) {
    console.log('[reportMessage]', message, context ?? '');
  }
}

export function setUserContext(user: { id?: string; email?: string; displayName?: string } | null): void {
  if (!sentry) return;
  if (!user) {
    sentry.setUser(null);
    return;
  }
  sentry.setUser({
    id: user.id,
    email: user.email,
    username: user.displayName,
  });
}

export function clearUserContext(): void {
  if (!sentry) return;
  sentry.setUser(null);
}
