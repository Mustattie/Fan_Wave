// Notification settings.
//
// iOS UAT 2026-10-15 (SKYC-135). Three defects, all of them the screen
// stating something it did not know:
//
//  1. `permissionGranted` was initialised to `true`, so the OS state was
//     asserted as granted before it had been read -- and stayed asserted
//     if the read threw.
//  2. Every switch showed the saved preference as though it described
//     what the device would actually deliver. With OS notifications off,
//     six rows read ON while nothing could arrive.
//  3. getNotificationPreferences() answers DEFAULT_PREFERENCES for a
//     failed read, a signed-out user AND a user with nothing stored --
//     the three are indistinguishable to the caller. Because
//     update_notification_preferences (mig 009) REPLACES the whole JSONB
//     column, one toggle after a failed read overwrote the user's real
//     saved settings with defaults. That is why this screen reads the
//     column itself: it needs the distinction that helper flattens.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Platform,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Bell, BellOff, AlertTriangle } from 'lucide-react-native';
import * as Notifications from 'expo-notifications';
import { Colors } from '@/constants/Colors';
import { supabase, getLocalUser } from '@/lib/supabase';
import {
  updateNotificationPreferences,
  registerForPushNotifications,
  NotificationPreferences,
  DEFAULT_PREFERENCES,
  PREFERENCE_LABELS,
} from '@/lib/notifications';

const PREF_KEYS = Object.keys(DEFAULT_PREFERENCES) as (keyof NotificationPreferences)[];

/** 'unknown' until the OS has actually been asked. Never assumed. */
export type PermissionState = 'unknown' | 'granted' | 'denied';

export type PreferenceLoad =
  | { status: 'loaded'; preferences: NotificationPreferences; stored: boolean }
  | { status: 'unavailable' };

/**
 * Stored JSONB → a complete preference object. Unknown keys are dropped
 * and missing ones fall back to the default, so a column written by an
 * older build cannot produce `undefined` switches.
 */
export function mergeStoredPreferences(stored: unknown): NotificationPreferences {
  const out = { ...DEFAULT_PREFERENCES };
  if (stored && typeof stored === 'object') {
    for (const key of PREF_KEYS) {
      const value = (stored as Record<string, unknown>)[key];
      if (typeof value === 'boolean') out[key] = value;
    }
  }
  return out;
}

/**
 * What a row means right now: the preference the user saved, and whether
 * the OS will let anything through. 'blocked' is the case the old screen
 * could not express.
 */
export function describeDelivery(
  permission: PermissionState,
  enabled: boolean,
): 'on' | 'off' | 'blocked' | 'unknown' {
  if (!enabled) return 'off';
  if (permission === 'granted') return 'on';
  if (permission === 'denied') return 'blocked';
  return 'unknown';
}

/**
 * Reads the preference column directly, keeping "could not read" apart
 * from "nothing saved yet". A missing users row counts as unavailable:
 * the update RPC matches on auth_id, so a write would silently affect no
 * rows and the screen would claim a save that never happened.
 */
export async function readStoredPreferences(): Promise<PreferenceLoad> {
  try {
    const { data: { user } } = await getLocalUser();
    if (!user) return { status: 'unavailable' };
    const { data, error } = await supabase
      .from('users')
      .select('notification_preferences')
      .eq('auth_id', user.id)
      .maybeSingle();
    if (error || !data) return { status: 'unavailable' };
    const raw = (data as { notification_preferences?: unknown }).notification_preferences;
    return {
      status: 'loaded',
      preferences: mergeStoredPreferences(raw),
      stored: raw != null,
    };
  } catch {
    return { status: 'unavailable' };
  }
}

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [prefsAvailable, setPrefsAvailable] = useState(false);
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [savingKey, setSavingKey] = useState<keyof NotificationPreferences | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const readPermission = useCallback(async (): Promise<PermissionState> => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      return status === 'granted' ? 'granted' : 'denied';
    } catch {
      // expo-notifications is absent in Expo Go (see lib/notifications).
      // Unknown is the truthful answer, not "granted".
      return 'unknown';
    }
  }, []);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    const [perm, load] = await Promise.all([readPermission(), readStoredPreferences()]);
    setPermission(perm);
    if (load.status === 'loaded') {
      setPreferences(load.preferences);
      setPrefsAvailable(true);
    } else {
      // Leave the switches showing defaults but refuse to write them:
      // the column replaces wholesale, so a toggle from here would
      // destroy settings we were never able to read.
      setPrefsAvailable(false);
    }
    setLoading(false);
  }, [readPermission]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  // The permission banner sends the user to system Settings, which means
  // the answer changes while this screen is in the background. Re-read on
  // return instead of leaving a stale "disabled" banner over a now-
  // enabled permission (or the reverse).
  useEffect(() => {
    let prev: AppStateStatus | null = AppState.currentState ?? null;
    const sub = AppState.addEventListener('change', (next) => {
      if (prev !== 'active' && next === 'active') {
        void readPermission().then(setPermission);
      }
      prev = next;
    });
    return () => sub.remove();
  }, [readPermission]);

  const handleToggle = useCallback(
    async (key: keyof NotificationPreferences) => {
      if (!prefsAvailable || savingKey) return;
      const previous = preferences;
      const updated = { ...preferences, [key]: !preferences[key] };
      setPreferences(updated);
      setSavingKey(key);
      setSaveError(null);
      try {
        await updateNotificationPreferences(updated);
        // The RPC returns void and does not report how many rows it
        // touched, so confirm the column really holds what we just sent
        // rather than reporting a save we cannot see.
        const confirmed = await readStoredPreferences();
        if (confirmed.status !== 'loaded' || confirmed.preferences[key] !== updated[key]) {
          setPreferences(previous);
          setSaveError('That did not save. Check your connection and try again.');
          return;
        }
        setPreferences(confirmed.preferences);
      } catch {
        setPreferences(previous);
        setSaveError('That did not save. Check your connection and try again.');
      } finally {
        setSavingKey(null);
      }
    },
    [preferences, prefsAvailable, savingKey],
  );

  const handleEnablePermission = useCallback(async () => {
    const token = await registerForPushNotifications();
    if (token) {
      setPermission('granted');
      return;
    }
    // Could not register. Re-read before blaming the OS: on Expo Go, or
    // when the token call failed for another reason, the permission may
    // be fine and sending the user to Settings would be a dead end.
    const perm = await readPermission();
    setPermission(perm);
    if (perm === 'granted') return;
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:').catch(() => {});
    } else {
      Linking.openSettings();
    }
  }, [readPermission]);

  const deliveryBlocked = permission === 'denied';
  const enabledCount = useMemo(
    () => PREF_KEYS.filter((k) => preferences[k]).length,
    [preferences],
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const keys = PREF_KEYS;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Delivery state, stated for what it is. The preference rows
            below are what the user asked for; this is whether the device
            will act on any of it. */}
        {deliveryBlocked && (
          <TouchableOpacity style={styles.permissionBanner} onPress={handleEnablePermission}>
            <BellOff size={20} color="#ff6b6b" />
            <View style={styles.permissionText}>
              <Text style={styles.permissionTitle}>
                Nothing will be delivered
              </Text>
              <Text style={styles.permissionSub}>
                Notifications are turned off for Fan Sphere in your device
                settings. Your choices below are saved either way — tap to
                turn delivery on.
              </Text>
            </View>
          </TouchableOpacity>
        )}
        {permission === 'unknown' && (
          <View style={[styles.permissionBanner, styles.unknownBanner]}>
            <Bell size={20} color={Colors.dark.textSecondary} />
            <View style={styles.permissionText}>
              <Text style={styles.unknownTitle}>
                Delivery status unavailable
              </Text>
              <Text style={styles.permissionSub}>
                We could not read your device's notification setting on this
                build, so we cannot say whether these will arrive. Your
                choices below are still saved.
              </Text>
            </View>
          </View>
        )}
        {permission === 'granted' && (
          <View style={[styles.permissionBanner, styles.okBanner]}>
            <Bell size={20} color={Colors.dark.success} />
            <View style={styles.permissionText}>
              <Text style={styles.okTitle}>Delivery is on</Text>
              <Text style={styles.permissionSub}>
                {enabledCount === 0
                  ? 'Every type below is switched off, so nothing will be sent.'
                  : `${enabledCount} of ${keys.length} notification types are on.`}
              </Text>
            </View>
          </View>
        )}

        {/* The read failed, and the update RPC replaces the whole column.
            Showing defaults as "your settings" and letting a toggle write
            them is how the real ones got lost. */}
        {!prefsAvailable && (
          <TouchableOpacity
            style={[styles.permissionBanner, styles.errorBanner]}
            onPress={() => void loadPreferences()}
          >
            <AlertTriangle size={20} color="#ff6b6b" />
            <View style={styles.permissionText}>
              <Text style={styles.permissionTitle}>
                Couldn't load your notification settings
              </Text>
              <Text style={styles.permissionSub}>
                The switches below show our defaults, not your saved
                choices, so they are locked until we can read them. Tap to
                retry.
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {saveError && (
          <View style={[styles.permissionBanner, styles.errorBanner]}>
            <AlertTriangle size={20} color="#ff6b6b" />
            <View style={styles.permissionText}>
              <Text style={styles.permissionTitle}>{saveError}</Text>
            </View>
          </View>
        )}

        <Text style={styles.sectionLabel}>
          {prefsAvailable ? 'NOTIFICATION TYPES' : 'NOTIFICATION TYPES (DEFAULTS)'}
        </Text>

        {keys.map((key) => {
          const { title, description } = PREFERENCE_LABELS[key];
          const delivery = describeDelivery(permission, preferences[key]);
          return (
            <View key={key} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{title}</Text>
                <Text style={styles.rowDesc}>{description}</Text>
                {/* Saved preference and actual delivery are two facts.
                    A row that is ON while the OS blocks us says so. */}
                {delivery === 'blocked' ? (
                  <Text style={styles.rowBlocked}>
                    Saved, but not delivered while notifications are off
                  </Text>
                ) : null}
              </View>
              {savingKey === key ? (
                <ActivityIndicator size="small" color={Colors.dark.accent} />
              ) : (
                <Switch
                  value={preferences[key]}
                  onValueChange={() => handleToggle(key)}
                  disabled={!prefsAvailable || savingKey !== null}
                  trackColor={{ false: Colors.dark.surfaceLight, true: Colors.dark.accent }}
                  thumbColor="#fff"
                />
              )}
            </View>
          );
        })}

        <Text style={styles.footnote}>
          These switches record what you want to be notified about. Whether a
          notification reaches you also depends on your device settings and
          network connection. Game-time notifications are sent based on your
          followed teams and tier level.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  backBtn: {
    padding: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.3)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  unknownBanner: {
    backgroundColor: Colors.dark.surface,
    borderColor: Colors.dark.border,
  },
  unknownTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  okBanner: {
    backgroundColor: 'rgba(46, 213, 115, 0.08)',
    borderColor: 'rgba(46, 213, 115, 0.28)',
  },
  okTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.dark.success,
  },
  errorBanner: {
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderColor: 'rgba(255, 107, 107, 0.3)',
  },
  permissionText: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ff6b6b',
  },
  permissionSub: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.dark.textMuted,
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
  },
  rowText: {
    flex: 1,
    marginRight: 16,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  rowDesc: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  rowBlocked: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ff6b6b',
    marginTop: 4,
  },
  footnote: {
    fontSize: 12,
    color: Colors.dark.textMuted,
    lineHeight: 18,
    marginTop: 24,
    textAlign: 'center',
  },
});
