import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Colors } from '@/constants/Colors';
import { getOfflineQueue, clearOfflineQueue } from '@/lib/cache';
import { supabase } from '@/lib/supabase';

/**
 * Lightweight offline banner using basic navigator.onLine / NetInfo pattern.
 * Shows a banner at the top of the screen when the device goes offline.
 */
export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const wasOffline = useRef(false);

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

  if (!isOffline) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>No internet connection</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#ff4444',
    paddingVertical: 6,
    alignItems: 'center',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
});
