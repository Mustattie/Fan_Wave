import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { LogBox } from 'react-native';
import { StatusBar } from 'expo-status-bar';

LogBox.ignoreLogs([
  "The action 'GO_BACK' was not handled by any navigator",
]);
import { Session } from '@supabase/supabase-js';
import { supabase, setupAuthDeepLinkHandler } from '@/lib/supabase';
import { registerForPushNotifications, clearPushToken, setupNotificationResponseListener } from '@/lib/notifications';
import { recordDailyActivity } from '@/lib/gamification';
import { startAnalyticsFlush } from '@/lib/analytics';
import { OfflineBanner } from '@/components/OfflineBanner';
import { AppQueryClientProvider } from '@/hooks/useQueryClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-reanimated';
import { initErrorReporting, setUserContext, clearUserContext } from '@/lib/errorReporting';
import { configureRevenueCat, useEntitlementsRealtime } from '@/lib/entitlements';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(auth)',
};

SplashScreen.preventAutoHideAsync();
initErrorReporting();

const FanWaveDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0f0f1a',
    card: '#16162a',
    text: '#ffffff',
    border: '#2a2a4a',
    primary: '#6c5ce7',
  },
};

// Subscribes to Realtime UPDATEs on the current user's row so entitlement
// state flips in-app within ~1 second of a RevenueCat webhook write.
function EntitlementsRealtimeBridge() {
  useEntitlementsRealtime();
  return null;
}

function NavigationGuard({
  session,
  onboardingComplete,
  hasSeenWelcome,
}: {
  session: Session | null;
  onboardingComplete: boolean;
  hasSeenWelcome: boolean;
}) {
  const segments = useSegments() as string[];
  const router = useRouter();
  const navigationState = useRootNavigationState();

  useEffect(() => {
    if (!navigationState?.key) return;

    const inAuthGroup = segments[0] === '(auth)';
    const onOnboardingScreen =
      typeof segments[1] === 'string' && segments[1].startsWith('onboarding');
    const onWelcomeScreen = segments[1] === 'welcome';

    if (!session && !inAuthGroup) {
      if (!hasSeenWelcome) {
        router.replace('/(auth)/welcome');
      } else {
        router.replace('/(auth)/sign-in');
      }
    } else if (session && inAuthGroup && !onOnboardingScreen && !onWelcomeScreen) {
      if (!onboardingComplete) {
        router.replace('/(auth)/onboarding-sports');
      } else {
        router.replace('/(tabs)');
      }
    }
  }, [session, segments, navigationState?.key, onboardingComplete, hasSeenWelcome]);

  return null;
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [hasSeenWelcome, setHasSeenWelcome] = useState(true); // default true to avoid flash

  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    // Race Supabase auth against a 5-second timeout to prevent
    // the app from hanging on slow/unreachable networks
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    const authCheck = supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    }).catch(() => {});

    Promise.race([authCheck, timeout]).finally(() => {
      setInitialized(true);
    });

    Promise.all([
      AsyncStorage.getItem('onboarding_complete'),
      AsyncStorage.getItem('has_seen_welcome'),
    ]).then(([onboarding, welcome]) => {
      setOnboardingComplete(onboarding === 'true');
      setHasSeenWelcome(welcome === 'true');
      setOnboardingChecked(true);
    }).catch(() => {
      setOnboardingChecked(true);
    });

    // Server-truth onboarding check: users.onboarded_at is the authoritative
    // signal (set in onboarding-city, back-filled by migration 020). Survives
    // AsyncStorage wipes (reinstall, device switch, Expo Go cache clear).
    // Note: users.auth_id links to auth.uid; users.id is separate.
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase
        .from('users')
        .select('onboarded_at')
        .eq('auth_id', user.id)
        .maybeSingle();
      if (data?.onboarded_at) {
        setOnboardingComplete(true);
        AsyncStorage.setItem('onboarding_complete', 'true').catch(() => {});
      }
    }).catch(() => {});

    // RevenueCat SDK init — safe no-op if API keys aren't configured yet.
    configureRevenueCat().catch(() => {});

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        if (event === 'SIGNED_IN' && session) {
          setUserContext({ id: session.user.id, email: session.user.email });
          registerForPushNotifications();
          recordDailyActivity();
          startAnalyticsFlush();
          // Tie the RevenueCat user to our auth.users.id so webhooks can map back.
          configureRevenueCat(session.user.id).catch(() => {});
        } else if (event === 'SIGNED_OUT') {
          clearUserContext();
          clearPushToken();
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Handle auth deep links (email confirmation, password reset)
  useEffect(() => {
    const cleanup = setupAuthDeepLinkHandler();
    return cleanup;
  }, []);

  // Handle notification taps → deep link to correct screen
  useEffect(() => {
    const cleanup = setupNotificationResponseListener();
    return cleanup;
  }, []);

  useEffect(() => {
    if (loaded && initialized && onboardingChecked) {
      SplashScreen.hideAsync();
    }
  }, [loaded, initialized, onboardingChecked]);

  // Failsafe: force splash to hide after 8 seconds no matter what
  useEffect(() => {
    const failsafe = setTimeout(() => {
      setInitialized(true);
      setOnboardingChecked(true);
      SplashScreen.hideAsync();
    }, 8000);
    return () => clearTimeout(failsafe);
  }, []);

  if (!loaded || !initialized || !onboardingChecked) {
    return null;
  }

  return (
    <AppQueryClientProvider>
      <ThemeProvider value={FanWaveDarkTheme}>
        <StatusBar style="light" />
        <OfflineBanner />
        <EntitlementsRealtimeBridge />
        <NavigationGuard session={session} onboardingComplete={onboardingComplete} hasSeenWelcome={hasSeenWelcome} />
        <Stack>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(admin)" options={{ headerShown: false }} />
          <Stack.Screen
            name="fan-group/[id]"
            options={{ headerShown: false, presentation: 'card' }}
          />
          <Stack.Screen
            name="watch-party/[id]"
            options={{ headerShown: false, presentation: 'card' }}
          />
          <Stack.Screen
            name="create-watch-party"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="modal"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen name="my-clips" options={{ headerShown: false }} />
          <Stack.Screen
            name="create-clip"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen name="rsvp-history" options={{ headerShown: false }} />
          <Stack.Screen name="my-teams" options={{ headerShown: false }} />
          <Stack.Screen name="notification-settings" options={{ headerShown: false }} />
          <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
          <Stack.Screen name="creator-stats" options={{ headerShown: false }} />
          <Stack.Screen
            name="create-wc-group"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen name="legal" options={{ headerShown: false }} />
          <Stack.Screen name="blocked-users" options={{ headerShown: false }} />
        </Stack>
      </ThemeProvider>
    </AppQueryClientProvider>
  );
}
