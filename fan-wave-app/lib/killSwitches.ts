// Operational kill switches (P3.3, 2026-09-25).
//
// Four high-load features can be switched off from the `feature_flags`
// table without a deploy: set `enabled = false` on the row for the key.
// The switch is for emergency degradation, not product gating -- when
// Realtime is overloaded the app keeps its REST reads and stops joining
// channels; when the chat or upload path is hurting the database, sends
// and uploads pause with a plain message instead of failing obscurely.
//
// Rules that keep this safe:
//   - Fail OPEN. A missing row, a fetch error, an expired cache or a cold
//     start all mean "enabled". Only an explicit `enabled = false` (or an
//     active date window that excludes now) switches a feature off.
//   - Synchronous reads. Gate points call isFeatureEnabled() inline; the
//     table is polled every KILL_SWITCH_POLL_MS and on every return to the
//     foreground, so a flip lands within ~5 minutes on active devices.
//   - One query for all keys per poll (`.in('key', …)`), never per gate.
//
// lib/featureFlags.ts (1 h cache, fail-closed) remains for product flags;
// kill switches need the opposite defaults, so they live here.

import { AppState, type AppStateStatus } from 'react-native';
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { addBreadcrumb, reportError } from '@/lib/errorReporting';

export type KillSwitchKey = 'clips_upload' | 'chat_send' | 'games_realtime' | 'presence';

export const KILL_SWITCH_KEYS: readonly KillSwitchKey[] = [
  'clips_upload',
  'chat_send',
  'games_realtime',
  'presence',
];

export const KILL_SWITCH_POLL_MS = 5 * 60 * 1000;
const STORAGE_KEY = 'killSwitches.v1';

interface FlagRow {
  key: string;
  enabled: boolean;
  start_date?: string | null;
  end_date?: string | null;
}

const state: Record<KillSwitchKey, boolean> = {
  clips_upload: true,
  chat_send: true,
  games_realtime: true,
  presence: true,
};
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let initialized = false;

function emit(): void {
  for (const l of listeners) l();
}

/** Synchronous read for gate points. Unknown keys are enabled. */
export function isFeatureEnabled(key: KillSwitchKey): boolean {
  return state[key] !== false;
}

/** Reactive read for UI (buttons, banners). */
export function useKillSwitch(key: KillSwitchKey): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => isFeatureEnabled(key),
    () => true,
  );
}

function rowIsEnabled(row: FlagRow, now: Date): boolean {
  if (row.enabled === false) return false;
  if (row.start_date && now < new Date(row.start_date)) return false;
  if (row.end_date && now > new Date(row.end_date)) return false;
  return true;
}

/**
 * Turn a set of rows into the next state. Keys without a row stay
 * enabled. Exported for tests.
 */
export function applyKillSwitchRows(rows: FlagRow[], now: Date = new Date()): Record<KillSwitchKey, boolean> {
  const next: Record<KillSwitchKey, boolean> = {
    clips_upload: true,
    chat_send: true,
    games_realtime: true,
    presence: true,
  };
  for (const row of rows) {
    if ((KILL_SWITCH_KEYS as readonly string[]).includes(row.key)) {
      next[row.key as KillSwitchKey] = rowIsEnabled(row, now);
    }
  }
  return next;
}

function setState(next: Record<KillSwitchKey, boolean>): void {
  let changed = false;
  for (const k of KILL_SWITCH_KEYS) {
    if (state[k] !== next[k]) {
      changed = true;
      addBreadcrumb('realtime', 'kill_switch', { key: k, enabled: next[k] });
      state[k] = next[k];
    }
  }
  if (changed) emit();
}

/** Ask the server once. Errors keep the current state (fail open). */
export async function refreshKillSwitches(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('feature_flags')
      .select('key, enabled, start_date, end_date')
      .in('key', KILL_SWITCH_KEYS as unknown as string[]);
    if (error || !data) return;
    const next = applyKillSwitchRows(data as FlagRow[]);
    setState(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  } catch (e) {
    reportError(e, { source: 'killSwitches.refresh' });
  }
}

/**
 * Start polling. Idempotent. Loads the last known state from disk first
 * so a device that was told "chat is off" before it went to sleep does
 * not spend its first minutes back online sending into a paused chat.
 */
export function initKillSwitches(): void {
  if (initialized) return;
  initialized = true;
  AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Record<KillSwitchKey, boolean>>;
      const next = { ...state };
      for (const k of KILL_SWITCH_KEYS) if (typeof parsed[k] === 'boolean') next[k] = parsed[k]!;
      setState(next);
    })
    .catch(() => {})
    .finally(() => {
      void refreshKillSwitches();
    });
  pollTimer = setInterval(() => void refreshKillSwitches(), KILL_SWITCH_POLL_MS);
  appStateSub = AppState.addEventListener('change', (s: AppStateStatus) => {
    if (s === 'active') void refreshKillSwitches();
  });
}

/** Test hook. */
export function _resetKillSwitchesForTests(): void {
  for (const k of KILL_SWITCH_KEYS) state[k] = true;
  listeners.clear();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  appStateSub?.remove();
  appStateSub = null;
  initialized = false;
}
