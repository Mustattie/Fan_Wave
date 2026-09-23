// Password-recovery state (Build 28 UAT, 2026-09-24).
//
// A recovery link is exchanged for a real session (setSession / verifyOtp),
// which emits SIGNED_IN -- the same event a normal sign-in emits. The
// consumer routes to /(auth)/reset-password, but NavigationGuard's
// signed-in branch treats every (auth) screen except onboarding, welcome
// and the payment screens as "you're done here" and replaces it with the
// tabs. So the user was signed in with the old password and never saw the
// new-password screen. The legacy PASSWORD_RECOVERY handler would have
// been bounced the same way.
//
// This flag is the missing piece: set when a recovery link is consumed,
// read by the guard (which then allows only reset-password while it is
// set), cleared when the password is updated or the user backs out. It is
// in-memory on purpose -- a process kill between the link and the screen
// leaves an ordinary signed-in session, exactly as today, and the user can
// request another link. Nothing here touches tokens.

import { useSyncExternalStore } from 'react';

let pending = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function markRecoveryPending(): void {
  if (pending) return;
  pending = true;
  emit();
}

export function clearRecoveryPending(): void {
  if (!pending) return;
  pending = false;
  emit();
}

export function isRecoveryPending(): boolean {
  return pending;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Reactive read for NavigationGuard. */
export function useRecoveryPending(): boolean {
  return useSyncExternalStore(subscribe, isRecoveryPending, isRecoveryPending);
}

/** Test hook. */
export function _resetAuthRecoveryForTests(): void {
  pending = false;
  listeners.clear();
}
