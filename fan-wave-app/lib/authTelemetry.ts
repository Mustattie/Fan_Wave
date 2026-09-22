// Auth telemetry: tell an intentional sign-out apart from a session the
// client lost on its own, and keep the last auth-endpoint failure around so
// the SIGNED_OUT report can say why.
//
// Phase 1 (2026-09-16 scalability review). The v9.5.5 fix made SIGNED_OUT
// the only event that clears the session, which is right -- but auth-js
// emits SIGNED_OUT itself whenever a token refresh fails with a
// non-retryable error (a 429 from the per-IP refresh limit, or a refresh
// token that was already rotated). Those looked identical to the user
// tapping Sign Out. Now every app-initiated sign-out is marked first, and
// the SIGNED_OUT handler in app/_layout.tsx reports anything unmarked.
//
// Nothing in here ever holds a token. `recordAuthFailure` takes a status
// and an error code, never a body or a header.

import { addBreadcrumb, reportMessage } from './errorReporting';

export interface AuthFailure {
  /** Which GoTrue endpoint failed, e.g. 'token' or 'user'. */
  endpoint: string;
  status: number;
  /** GoTrue's error_code / error field when the body carried one. */
  errorCode: string | null;
  at: string;
}

// How long a mark stays valid. signOut() resolves in well under a second;
// 30 s is generous enough that a slow network cannot turn an intentional
// sign-out into a false "unexpected" report.
const INTENTIONAL_WINDOW_MS = 30_000;

let intentionalSignOutAt: number | null = null;
let lastAuthFailure: AuthFailure | null = null;

/** Call immediately before any app-initiated `supabase.auth.signOut()`. */
export function markIntentionalSignOut(): void {
  intentionalSignOutAt = Date.now();
  addBreadcrumb('auth', 'sign_out.intentional');
}

/**
 * Returns true if a sign-out was marked recently, and clears the mark.
 * Called from the SIGNED_OUT handler so the mark is consumed exactly once.
 */
export function consumeIntentionalSignOut(): boolean {
  const at = intentionalSignOutAt;
  intentionalSignOutAt = null;
  return at !== null && Date.now() - at <= INTENTIONAL_WINDOW_MS;
}

export function recordAuthFailure(failure: Omit<AuthFailure, 'at'>): void {
  lastAuthFailure = { ...failure, at: new Date().toISOString() };
  addBreadcrumb('auth', `endpoint_failure.${failure.endpoint}`, {
    status: failure.status,
    errorCode: failure.errorCode,
  });
}

export function getLastAuthFailure(): AuthFailure | null {
  return lastAuthFailure;
}

/**
 * Report a SIGNED_OUT that the app did not ask for. Includes the last auth
 * failure (status + code only) so the report can distinguish "refresh got
 * a 429" from "refresh token already used" from "no failure recorded".
 */
export function reportUnexpectedSignOut(): void {
  const failure = getLastAuthFailure();
  reportMessage('auth.unexpected_signed_out', 'warning', {
    lastAuthFailure: failure,
  });
  addBreadcrumb('auth', 'sign_out.unexpected', {
    lastFailureStatus: failure?.status ?? null,
    lastFailureCode: failure?.errorCode ?? null,
  });
}

/** Test hook. */
export function _resetAuthTelemetryForTests(): void {
  intentionalSignOutAt = null;
  lastAuthFailure = null;
}
