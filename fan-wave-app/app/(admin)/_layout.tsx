import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Colors } from '@/constants/Colors';
import { useIsAdmin } from '@/hooks/useAdminData';

export default function AdminLayout() {
  const router = useRouter();
  const { data: isAdmin, isLoading } = useIsAdmin();

  useEffect(() => {
    if (!isLoading && isAdmin === false) {
      router.replace('/(tabs)');
    }
  }, [isAdmin, isLoading]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.dark.accent} />
      </View>
    );
  }

  if (!isAdmin) return null;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.dark.surface },
        headerTintColor: Colors.dark.accent,
        headerTitleStyle: { color: Colors.dark.text, fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: Colors.dark.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Admin Dashboard' }} />
      <Stack.Screen name="parties" options={{ title: 'Live Parties' }} />
      <Stack.Screen name="groups" options={{ title: 'Fan Groups' }} />
      <Stack.Screen name="users" options={{ title: 'Users' }} />
      <Stack.Screen name="geography" options={{ title: 'Geography' }} />
      <Stack.Screen name="activity" options={{ title: 'Activity Feed' }} />
      <Stack.Screen name="testers" options={{ title: 'Beta Testers' }} />
      <Stack.Screen name="moderation" options={{ title: 'Moderation' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.background,
  },
});
