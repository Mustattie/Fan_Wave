import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/Colors';
import { getOfflineQueue, clearOfflineQueue } from '@/lib/cache';
import { supabase } from '@/lib/supabase';
import { getRealtimeDiagnostics } from '@/lib/realtime';

// P3.4 (2026-09-25): how long live channels may sit disconnected before
// the banner says so. Short blips (a tab switch, a cell handoff) recover
// inside this window and never show anything.
const REALTIME_DEGRADED_AFTER_MS = 20_000;
const REALTIME_POLL_MS = 5_000;

/**
 * Lightweight offline banner using basic navigator.onLine / NetInfo pattern.
 * Shows a banner at the top of the screen when the device goes offline.
 */
export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [isOffline, setIsOffline] = useState(false);
  const wasOffline = useRef(false);
  // P3.4: realtime degraded = the app holds live channels but the socket
  // has been down (or a joined channel has not re-joined) for a while.
  // REST keeps working; the user just is not getting live pushes.
  const [realtimeDegraded, setRealtimeDegraded] = useState(false);
  const degradedSinceRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const poll = () => {
      if (!mounted) return;
      let degraded = false;
      try {
        const d = getRealtimeDiagnostics();
        const wanted = d.topics.filter((t) => t.subscribers > 0);
        const stuck = wanted.some((t) => t.subscribedOnce && t.status !== 'SUBSCRIBED');
        degraded = wanted.length > 0 && (!d.socketConnected || stuck);
      } catch {
        degraded = false;
      }
      const now = Date.now();
      if (!degraded) {
        degradedSinceRef.current = null;
        setRealtimeDegraded(false);
        return;
      }
      if (degradedSinceRef.current === null) degradedSinceRef.current = now;
      setRealtimeDegraded(now - degradedSinceRef.current >= REALTIME_DEGRADED_AFTER_MS);
    };
    poll();
    const interval = setInterval(poll, REALTIME_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Process offline queue when coming back online
  useEffect(() => {
    if (wasOffline.current && !isOffline) {
      (async () => {
        const queue = await getOfflineQueue();
        if (queue.length === 0) return;

        for (const action of queue) {
          try {
            if (action.type === 'rsvp') {
              await supabase.rpc('rsvp_to_watch_party', action.payload);
            } else if (action.type === 'message') {
              await supabase.from('messages').insert(action.payload);
            } else if (action.type === 'join_group') {
              await supabase.from('chat_room_members').insert(action.payload);
            }
          } catch {
            // Individual action failed — skip, don't block others
          }
        }
        await clearOfflineQueue();
      })();
    }
    wasOffline.current = isOffline;
  }, [isOffline]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleOnline = () => setIsOffline(false);
      const handleOffline = () => setIsOffline(true);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      setIsOffline(!navigator.onLine);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }

    // Native: use a lightweight polling approach
    // (full NetInfo would be better but avoids adding a dependency)
    let mounted = true;
    const check = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        await fetch('https://clients3.google.com/generate_204', {
          method: 'HEAD',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (mounted) setIsOffline(false);
      } catch {
        if (mounted) setIsOffline(true);
      }
    };

    check();
    const interval = setInterval(check, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // The banner is the first child above <Stack> in the root layout with
  // nothing applying insets, so on a notched / Dynamic Island iPhone (and
  // Android edge-to-edge) it drew under the status bar. The degraded
  // variant shows on any 20 s socket blip, so this was going to be seen.
  const insetStyle = { paddingTop: insets.top + 6 };
  if (isOffline) {
    return (
      <View style={[styles.banner, insetStyle]}>
        <Text style={styles.text}>No internet connection</Text>
      </View>
    );
  }
  if (realtimeDegraded) {
    return (
      <View style={[styles.banner, styles.bannerDegraded, insetStyle]}>
        <Text style={styles.text}>Live updates paused — reconnecting…</Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#ff4444',
    paddingVertical: 6,
    alignItems: 'center',
  },
  bannerDegraded: {
    backgroundColor: Colors.dark.warning,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
});
