// Deep-link landing route for watch-party invites.
//
// SMS / share links are `https://fansphere.org/party/<uuid>` (see
// lib/sharing.ts:108). Once Universal Links (iOS `associatedDomains`
// in app.json) and Android App Links (`intentFilters` in app.json)
// resolve, tapping that URL on a device with Fan Sphere installed
// opens the app straight to this route -- which just redirects to
// the existing watch-party detail screen at /watch-party/[id].
//
// Kept as its own route (instead of aliasing the watch-party screen
// directly) so the deep-link entry point stays greppable and so we
// can attach analytics ("invite_opened" tracking, source attribution)
// without cluttering the main detail screen.

import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';
import { trackEvent } from '@/lib/analytics';

export default function PartyDeepLinkRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (!id) return;
    trackEvent('invite_opened', 'party', { id });
    router.replace(`/watch-party/${id}` as any);
  }, [id, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.dark.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.background,
  },
});
