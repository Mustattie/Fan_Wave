import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments, useRootNavigationState, ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { LogBox, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

LogBox.ignoreLogs([
  "The action 'GO_BACK' was not handled by any navigator",
  // Expo Go noise-floor filters (v9.1 UAT 2026-07-21). These fire on every
  // clip mount / launch inside Expo Go and buried real errors during UAT.
  // None affect EAS builds — the underlying issues are Expo Go-only quirks.
  "VideoPlayer.replace",
  "expo-notifications: Android Push notifications",
  "ImagePicker.MediaTypeOptions` have been deprecated",
]);
import { Session } from '@supabase/supabase-js';
import { supabase, setupAuthDeepLinkHandler } from '@/lib/supabase';
import { registerForPushNotifications, clearPushToken, setupNotificationResponseListener } from '@/lib/notifications';
import { recordDailyActivity } from '@/lib/gamification';
import { startAnalyticsFlush, setAnalyticsUser } from '@/lib/analytics';
import { OfflineBanner } from '@/components/OfflineBanner';
import { AppQueryClientProvider } from '@/hooks/useQueryClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-reanimated';
import { initErrorReporting, setUserContext, clearUserContext, reportError } from '@/lib/errorReporting';
import { configureRevenueCat, useEntitlementsRealtime, useSubscriptionState } from '@/lib/entitlements';
import { useGamesRealtime } from '@/lib/realtime';
import { useAppStateFocus } from '@/lib/appState';
import { queryClient } from '@/hooks/useQueryClient';

// Custom ErrorBoundary so React render-tree crashes (the "Something went
// wrong / Cannot read property 'X' of null" screen) ALSO get reported to
// Sentry instead of just being shown to the user. expo-router's default
// boundary renders the screen but does not report. v8.3 UAT had the
// Soccer Cup tab crash with stage.replace-of-null and we only found it
// from a user screenshot — Sentry-backed boundary closes that gap.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    reportError(error, {
      source: 'RootErrorBoundary',
      name: error?.name,
      stack: error?.stack?.split('\n').slice(0, 8).join('\n'),
    });
  }, [error]);

  return (
    <SafeAreaView style={errorBoundaryStyles.container}>
      <View style={errorBoundaryStyles.content}>
        <Text style={errorBoundaryStyles.title}>Something went wrong</Text>
        <Text style={errorBoundaryStyles.message} numberOfLines={6}>
          {error?.message ?? 'Unknown error'}
        </Text>
        <TouchableOpacity style={errorBoundaryStyles.button} onPress={retry}>
          <Text style={errorBoundaryStyles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const errorBoundaryStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  content: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: '#fff', marginBottom: 12 },
  message: { fontSize: 14, color: '#bdbdc7', marginBottom: 24, lineHeight: 20 },
  button: {
    backgroundColor: '#6c5ce7',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

export const unstable_settings = {
  initialRouteName: '(auth)',
};

SplashScreen.preventAutoHideAsync();
initErrorReporting();

const FanSphereDarkTheme = {
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

// Subscribes to Realtime UPDATEs on the games table so the Today's Games
// carousel refreshes within ~1 second of the live cron writing a new
// score / status. Debounced 500ms inside the hook so burst writes (17 MLB
// rows at once) coalesce into one refetch.
function GamesRealtimeBridge() {
  useGamesRealtime();
  return null;
}

// Bridges React Native AppState into React Query's focusManager so queries
// with refetchOnWindowFocus refetch when the user returns from background.
function AppStateFocusBridge() {
  useAppStateFocus();
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
  // Entitlement state drives the new post-onboarding routing (FW-95).
  // While loading, hold off on navigation decisions to avoid flashing the
  // Choose Plan screen before we know the user's real status.
  const { data: entState, isLoading: entLoading } = useSubscriptionState();
  const subscriptionStatus = entState?.status ?? 'none';
  const hasPremiumAccess = entState?.hasPremiumAccess ?? false;

  useEffect(() => {
    if (!navigationState?.key) return;
    // Wait for entitlement state to load — otherwise a trial/active user
    // would briefly route to Choose Plan based on the default 'none'.
    if (session && entLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const onOnboardingScreen =
      typeof segments[1] === 'string' && segments[1].startsWith('onboarding');
    const onWelcomeScreen = segments[1] === 'welcome';
    const onPaymentScreen =
      segments[1] === 'choose-plan' ||
      segments[1] === 'resubscribe';

    if (!session && !inAuthGroup) {
      if (!hasSeenWelcome) {
        router.replace('/(auth)/welcome');
      } else {
        router.replace('/(auth)/sign-in');
      }
    } else if (session && inAuthGroup && !onOnboardingScreen && !onWelcomeScreen && !onPaymentScreen) {
      // Post-onboarding routing. Free-tier (status='none' or 'trial') lands
      // in tabs and uses <PaywallGate> per-feature. Only churn states
      // (cancelled/expired) get nudged to resubscribe.
      if (!onboardingComplete) {
        router.replace('/(auth)/onboarding-sports');
      } else if (subscriptionStatus === 'cancelled' || subscriptionStatus === 'expired') {
        router.replace('/(auth)/resubscribe');
      } else {
        router.replace('/(tabs)');
      }
    } else if (session && !inAuthGroup && onboardingComplete) {
      // Resume gate: NEVER bounce a free user out of the tabs. Per-feature
      // <PaywallGate> components handle the upgrade prompts where they
      // actually matter (clip post, fan group create, message send).
      // Live Android v5 P1: 45-min-idle resume was dumping free users on
      // /(auth)/choose-plan, hijacking their last screen.
      if (subscriptionStatus === 'cancelled' || subscriptionStatus === 'expired') {
        router.replace('/(auth)/resubscribe');
      }
    }
  }, [session, segments, navigationState?.key, onboardingComplete, hasSeenWelcome, subscriptionStatus, hasPremiumAccess, entLoading]);

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
    //
    // v8.7+ P0: previously this ran ONCE on mount, BEFORE the SIGNED_IN
    // event fires for a fresh signup. The user object was null at this
    // point, the check returned early, and `onboardingComplete` stayed
    // false in React state for the entire session. AsyncStorage was the
    // only thing keeping the user out of an onboarding loop — and any
    // AsyncStorage clear (Expo Go cache, app reinstall, crash) put the
    // user permanently on onboarding-sports despite having a complete
    // server profile. Hoisted into a reusable helper called from BOTH
    // mount AND onAuthStateChange so SIGNED_IN / INITIAL_SESSION both
    // refresh the flag.
    const refreshOnboardedFromServer = async (userId: string) => {
      try {
        const { data } = await supabase
          .from('users')
          .select('onboarded_at')
          .eq('auth_id', userId)
          .maybeSingle();
        if (data?.onboarded_at) {
          setOnboardingComplete(true);
          AsyncStorage.setItem('onboarding_complete', 'true').catch(() => {});
        }
      } catch {
        // Network failure — AsyncStorage path still owns the decision.
      }
    };

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) refreshOnboardedFromServer(user.id);
    }).catch(() => {});

    // RevenueCat SDK init — safe no-op if API keys aren't configured yet.
    configureRevenueCat().catch(() => {});

    // v8.5 P0: seed AsyncStorage 'user_city' from users.home_city so
    // the venue-search center cascade (create-watch-party.tsx) and
    // the Discover/My Groups city filters all hit the right value.
    // CRITICAL: must run for BOTH 'SIGNED_IN' (fresh sign-in) AND
    // 'INITIAL_SESSION' (persisted-session app boot). v8.4 only fixed
    // the Groups tab's write path — if a user signed in days ago and
    // had never opened the Groups tab, AsyncStorage was empty and the
    // venue-search center cascade fell through to Chicago even though
    // public.users.home_city='Dallas'. Reported by the founder on
    // 2026-06-19 ("I set my base city as Dallas and not sure why
    // system always defaults to Chicago").
    const seedUserCityFromProfile = (userId: string) => {
      // Wrap in Promise.resolve so the catch() handler is type-safe —
      // the Supabase builder returns a PromiseLike, not a real Promise.
      // Cold-boot networking can throw; catch so we don't surface an
      // unhandled promise rejection (which RN logs as a yellow warning
      // + lands in Sentry as noise).
      //
      // We seed BOTH city and state. The geocoder (Nominatim) is
      // ambiguous on city alone — "Dallas" matches Dallas TX, OR, PA,
      // GA — so the venue-search center cascade builds its query as
      // "City, ST" when state is available.
      Promise.resolve(
        supabase
          .from('users')
          .select('home_city, home_state')
          .eq('auth_id', userId)
          .maybeSingle()
      )
        .then(({ data }) => {
          const city = (data?.home_city ?? '').toString().trim();
          const state = (data?.home_state ?? '').toString().trim();
          if (city) {
            AsyncStorage.setItem('user_city', city).catch(() => {});
          }
          if (state) {
            AsyncStorage.setItem('user_state', state).catch(() => {});
          }
          // v8.6 P0: invalidate the userCity React Query so consumers
          // (Home, Discover, useWatchParties, useWatchPartiesInfinite,
          // useMyGroups) re-fetch with the just-seeded value instead of
          // continuing to use whatever stale string the first render
          // pulled out of AsyncStorage. Without this the city seed only
          // takes effect after a tab switch — the symptom behind "Even
          // though i changed my location to Dallas, its still showing
          // Chicago on the Home page" from the 2026-06-20 UAT.
          queryClient.invalidateQueries({ queryKey: ['userCity'] });
          queryClient.invalidateQueries({ queryKey: ['watchParties'] });
          queryClient.invalidateQueries({ queryKey: ['watchPartiesInfinite'] });
          queryClient.invalidateQueries({ queryKey: ['myGroups'] });
        })
        .catch(() => {});
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        if (event === 'SIGNED_IN' && session) {
          setUserContext({ id: session.user.id, email: session.user.email });
          registerForPushNotifications();
          recordDailyActivity();
          // v9.2.3: setAnalyticsUser must be paired with startAnalyticsFlush.
          // Without it, currentUserId in lib/analytics.ts stays null, every
          // trackEvent buffers user_id=null, and the analytics_events RLS
          // insert policy (user_id = auth.uid()) silently rejects the whole
          // batch. Effect: content_shared, clip_liked, screen_viewed, and
          // every other tracked event has been dropped since the app
          // existed. Detected in v9.2 UAT when share_count refused to move.
          setAnalyticsUser(session.user.id);
          startAnalyticsFlush();
          // Tie the RevenueCat user to our auth.users.id so webhooks can map back.
          configureRevenueCat(session.user.id).catch(() => {});

          seedUserCityFromProfile(session.user.id);
          // v8.7+ P0: also re-check onboarded_at now that we have a real
          // session. Fresh signups miss the mount-time getUser() because
          // the session hadn't propagated yet.
          refreshOnboardedFromServer(session.user.id);
        } else if (event === 'INITIAL_SESSION' && session) {
          // Existing persisted session on app boot — re-seed the city
          // cache so the venue search center reflects current profile
          // even when the user hasn't signed out/in since editing it.
          // v9.2.3: same setAnalyticsUser call so persisted-session boots
          // hydrate analytics user id too. SIGNED_IN doesn't fire on
          // cold-open with a valid persisted session; only INITIAL_SESSION.
          setAnalyticsUser(session.user.id);
          startAnalyticsFlush();
          seedUserCityFromProfile(session.user.id);
          refreshOnboardedFromServer(session.user.id);
        } else if (event === 'SIGNED_OUT') {
          clearUserContext();
          clearPushToken();
          setAnalyticsUser(null);
        } else if (event === 'PASSWORD_RECOVERY') {
          // Fired by supabase-js after the reset-password deep link
          // completes setSession(). Route the user to the new-password
          // form so they don't sit on whatever screen the app happened
          // to be on when the link opened. Uses a require() to avoid a
          // circular import at module-load time.
          try {
            const { router } = require('expo-router');
            router.replace('/(auth)/reset-password');
          } catch {
            // Router not ready — the user can still navigate manually.
          }
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
      <ThemeProvider value={FanSphereDarkTheme}>
        <StatusBar style="light" />
        <OfflineBanner />
        <EntitlementsRealtimeBridge />
        <GamesRealtimeBridge />
        <AppStateFocusBridge />
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
            name="game/[id]"
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
            name="create-group"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen name="legal" options={{ headerShown: false }} />
          <Stack.Screen name="blocked-users" options={{ headerShown: false }} />
          <Stack.Screen name="subscription" options={{ headerShown: false }} />
          <Stack.Screen name="iap-debug" options={{ headerShown: false }} />
        </Stack>
      </ThemeProvider>
    </AppQueryClientProvider>
  );
}
