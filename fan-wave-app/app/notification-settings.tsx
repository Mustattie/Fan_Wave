import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Bell, BellOff } from 'lucide-react-native';
import * as Notifications from 'expo-notifications';
import { Colors } from '@/constants/Colors';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  registerForPushNotifications,
  NotificationPreferences,
  DEFAULT_PREFERENCES,
  PREFERENCE_LABELS,
} from '@/lib/notifications';

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [permissionGranted, setPermissionGranted] = useState(true);

  useEffect(() => {
    async function load() {
      // Check OS-level permission
      const { status } = await Notifications.getPermissionsAsync();
      setPermissionGranted(status === 'granted');

      // Load preferences from DB
      const prefs = await getNotificationPreferences();
      if (prefs) setPreferences(prefs);
      setLoading(false);
    }
    load();
  }, []);

  const handleToggle = useCallback(
    async (key: keyof NotificationPreferences) => {
      const updated = { ...preferences, [key]: !preferences[key] };
      setPreferences(updated);
      try {
        await updateNotificationPreferences(updated);
      } catch {
        // Revert on failure
        setPreferences(preferences);
      }
    },
    [preferences],
  );

  const handleEnablePermission = useCallback(async () => {
    const token = await registerForPushNotifications();
    if (token) {
      setPermissionGranted(true);
    } else {
      // Open system settings
      if (Platform.OS === 'ios') {
        Linking.openURL('app-settings:');
      } else {
        Linking.openSettings();
      }
    }
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const keys = Object.keys(PREFERENCE_LABELS) as (keyof NotificationPreferences)[];

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
        {!permissionGranted && (
          <TouchableOpacity style={styles.permissionBanner} onPress={handleEnablePermission}>
            <BellOff size={20} color="#ff6b6b" />
            <View style={styles.permissionText}>
              <Text style={styles.permissionTitle}>Notifications are disabled</Text>
              <Text style={styles.permissionSub}>Tap to enable in Settings</Text>
            </View>
          </TouchableOpacity>
        )}

        <Text style={styles.sectionLabel}>NOTIFICATION TYPES</Text>

        {keys.map((key) => {
          const { title, description } = PREFERENCE_LABELS[key];
          return (
            <View key={key} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{title}</Text>
                <Text style={styles.rowDesc}>{description}</Text>
              </View>
              <Switch
                value={preferences[key]}
                onValueChange={() => handleToggle(key)}
                trackColor={{ false: Colors.dark.surfaceLight, true: Colors.dark.accent }}
                thumbColor="#fff"
              />
            </View>
          );
        })}

        <Text style={styles.footnote}>
          Notification delivery depends on your device settings and network connection.
          Game-time notifications are sent based on your followed teams and tier level.
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
  footnote: {
    fontSize: 12,
    color: Colors.dark.textMuted,
    lineHeight: 18,
    marginTop: 24,
    textAlign: 'center',
  },
});
