import { useEffect } from 'react';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/Colors';

// Legacy paths from the pre-v9.0 tab layout. Any deep link, notification,
// or in-app router.push that still points at one of these lands here after
// the tab-restructure. Redirect them to a sensible v9.0 destination so
// existing beta-tester bookmarks + push-notification payloads keep working.
const LEGACY_REDIRECTS: Record<string, string> = {
  '/soccer-cup': '/(tabs)/game-day',
  '/world-cup': '/(tabs)/game-day',
  '/(tabs)/world-cup': '/(tabs)/game-day',
  '/(tabs)/groups': '/(tabs)/discover',
  '/create-wc-group': '/create-group',
};

export default function NotFoundScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ unmatched?: string }>();

  useEffect(() => {
    const attempted = typeof params.unmatched === 'string' ? params.unmatched : '';
    // Strip any query string before matching so `/soccer-cup?tab=x` still
    // resolves to the base redirect.
    const bare = attempted.split('?')[0] ?? '';
    const dest = LEGACY_REDIRECTS[bare];
    if (dest) {
      router.replace(dest as any);
    }
  }, [params.unmatched, router]);

  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={styles.container}>
        <ActivityIndicator size="small" color={Colors.dark.accent} />
        <Text style={styles.title}>Redirecting…</Text>
        <Text style={styles.subtitle}>
          If this screen stays here, the page you tapped no longer exists — head to Home.
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: Colors.dark.background,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.dark.textMuted,
    textAlign: 'center',
    maxWidth: 260,
  },
});
