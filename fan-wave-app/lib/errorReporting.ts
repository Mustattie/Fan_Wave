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
// Only EXPO_PUBLIC_* variables are inlined into the JS bundle. The bare
// APP_ENV that eas.json sets is visible to the build process but is
// `undefined` here at runtime, so every build -- UAT included -- used to
// tag itself with NODE_ENV ('production'). EXPO_PUBLIC_APP_ENV carries the
// real value ('staging' for the preview profile) into the app.
const ENV =
  process.env.EXPO_PUBLIC_APP_ENV ||
  process.env.APP_ENV ||
  (process.env.NODE_ENV ?? 'development');

/**
 * A DSN is usable only if it looks like one. The placeholders that ship in
 * the .env templates (`__SET_PROD_SENTRY_DSN__`, `YOUR_...`) are not, and
 * handing them to Sentry.init() produces an "invalid DSN" error at boot
 * and no reporting -- silently, in a release build.
 */
export function isUsableDsn(dsn: string): boolean {
  return /^https:\/\/[^@\s]+@[^/\s]+\/\d+$/.test(dsn.trim());
}

/** Whether events are actually going to Sentry (vs. the console fallback). */
export function isErrorReportingActive(): boolean {
  return sentry !== null;
}

export function initErrorReporting(): void {
  if (initialised) return;
  initialised = true;

  if (!isUsableDsn(DSN)) {
    if (__DEV__) {
      console.log('[errorReporting] No usable Sentry DSN — using console fallback.');
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
    // UAT verification (2026-09-22): one info event per cold start, staging
    // builds only, so "did Sentry come up in this build" is answerable from
    // the dashboard within a minute of install instead of by waiting for a
    // real failure. Production builds send nothing here.
    if (ENV === 'staging' && !__DEV__) {
      sentry.captureMessage('uat.sentry_smoke', {
        level: 'info',
        extra: { environment: ENV, at: new Date().toISOString() },
      });
    }
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
  /** Indexed in Sentry (filterable, shown in the issue header), unlike `extra`. */
  tags?: Record<string, string>,
): void {
  if (sentry) {
    sentry.captureMessage(message, { level, extra: context, tags });
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

/**
 * Low-volume trail of what happened before an error: auth events, realtime
 * joins/errors, clip upload lifecycle. Attached to the next Sentry event;
 * printed in dev. Callers must never pass tokens or secrets in `data`.
 */
export function addBreadcrumb(
  category: 'auth' | 'realtime' | 'clips',
  message: string,
  data?: Record<string, string | number | boolean | null>,
): void {
  if (sentry) {
    sentry.addBreadcrumb({ category, message, data, level: 'info' });
    return;
  }
  if (__DEV__) {
    console.log(`[${category}] ${message}`, data ?? '');
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
