// Deep-link landing route for fan-group invites.
//
// Share links are `https://fansphere.org/group/<uuid>` (lib/sharing.ts:132
// and lib/inviteContacts.ts:117). Both have generated that URL since v9.4,
// but no route of that name existed -- so once App Links started resolving,
// a tapped group invite would have opened the app into +not-found. The
// /party/ equivalent was built at the time; this one was missed, which is
// why /group/* was not safe to list in the association files until now.
//
// Same shape as app/party/[id].tsx on purpose: kept as its own route rather
// than aliasing the detail screen so the deep-link entry point stays
// greppable and can carry its own attribution analytics.

import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';
import { trackEvent } from '@/lib/analytics';

export default function GroupDeepLinkRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (!id) return;
    trackEvent('invite_opened', 'fan_group', { id });
    router.replace(`/fan-group/${id}` as any);
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
