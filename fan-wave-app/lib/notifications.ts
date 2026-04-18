import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { supabase } from './supabase';

// expo-notifications is not supported in Expo Go (SDK 53+).
// All notification functions gracefully no-op when unavailable.
let Notifications: any = null;
try {
  Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  // expo-notifications not available (Expo Go)
}

/**
 * Request notification permission and register the Expo push token.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Notifications || !Device.isDevice) return null;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Fan Wave',
        importance: Notifications.AndroidImportance?.HIGH ?? 4,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#6c5ce7',
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
    });
    const token = tokenData.data;

    await supabase.rpc('register_push_token', { p_token: token });
    return token;
  } catch {
    return null;
  }
}

/**
 * Clear the push token from Supabase (call on sign out).
 */
export async function clearPushToken(): Promise<void> {
  try {
    await supabase.rpc('clear_push_token');
  } catch {
    // Silent — user is signing out anyway
  }
}

/**
 * Get the current notification preferences from Supabase.
 */
export async function getNotificationPreferences(): Promise<NotificationPreferences | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from('users')
      .select('notification_preferences')
      .eq('auth_id', user.id)
      .single();

    return data?.notification_preferences ?? DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Update notification preferences in Supabase.
 */
export async function updateNotificationPreferences(
  preferences: NotificationPreferences,
): Promise<void> {
  await supabase.rpc('update_notification_preferences', {
    p_preferences: preferences,
  });
}

export interface NotificationPreferences {
  score_updates: boolean;
  game_reminders: boolean;
  watch_party_reminders: boolean;
  group_activity: boolean;
  moment_alerts: boolean;
  clip_posted: boolean;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  score_updates: true,
  game_reminders: true,
  watch_party_reminders: true,
  group_activity: true,
  moment_alerts: false,
  clip_posted: false,
};

export const PREFERENCE_LABELS: Record<keyof NotificationPreferences, { title: string; description: string }> = {
  score_updates: {
    title: 'Score Updates',
    description: 'Goals, touchdowns, and score changes for your teams',
  },
  game_reminders: {
    title: 'Game Reminders',
    description: '30 minutes before your teams play',
  },
  watch_party_reminders: {
    title: 'Watch Party Reminders',
    description: '1 hour before parties you\'re attending',
  },
  group_activity: {
    title: 'Group Activity',
    description: 'New messages in your fan groups',
  },
  moment_alerts: {
    title: 'Moment Alerts',
    description: 'Big plays and moments from games you follow',
  },
  clip_posted: {
    title: 'New Clips',
    description: 'When someone posts a highlight in your groups',
  },
};

/**
 * Handle notification tap — navigate to the relevant screen.
 */
export function setupNotificationResponseListener(): () => void {
  if (!Notifications) return () => {};

  try {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response: any) => {
        const data = response.notification.request.content.data as Record<string, string> | undefined;
        if (!data?.screen) return;

        try {
          switch (data.screen) {
            case 'watch-party':
              if (data.party_id) router.push(`/watch-party/${data.party_id}` as any);
              break;
            case 'fan-group':
              if (data.group_id) router.push(`/fan-group/${data.group_id}` as any);
              break;
            case 'home':
            default:
              router.push('/(tabs)' as any);
              break;
          }
        } catch {
          // Navigation not ready — ignore
        }
      },
    );

    return () => subscription.remove();
  } catch {
    return () => {};
  }
}
