import { useEffect } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { focusManager } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// useAppStateFocus — bridges React Native AppState into React Query's
// focusManager. Without this, React Native queries don't refetch when the
// user backgrounds the app and returns, because focusManager is wired for
// browser window-focus by default.
//
// Pairs with useGamesRealtime in lib/realtime.ts: Realtime catches updates
// while the app is foregrounded; AppState refetch catches the gap when the
// WebSocket suspends during background and missed events on reconnect.
//
// Queries opt in by setting `refetchOnWindowFocus: true` (useGames does).
// Mount once at the root layout.
// ---------------------------------------------------------------------------
export function useAppStateFocus() {
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (Platform.OS === 'web') return;
      focusManager.setFocused(status === 'active');
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);
}
