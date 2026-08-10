// Notifications feed screen.
//
// v9.4.0 UAT Round 3: Home header's bell icon (#1) was a dead-end -- no
// onPress, no route. This scaffold gives the bell a real destination so
// the affordance stops lying. No notifications table exists yet, so the
// screen is empty-state-only. When the feed does ship (likely a real
// `notifications` table + fanout on likes / follows / RSVPs / mentions),
// swap the empty state for a FlatList reading the table.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Bell } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';

export default function NotificationsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.empty}>
        <Bell size={48} color={Colors.dark.textMuted} />
        <Text style={styles.emptyTitle}>You're all caught up</Text>
        <Text style={styles.emptyBody}>
          New activity from your groups, watch parties, and clips will show up here.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  title: { color: Colors.dark.text, fontSize: 17, fontWeight: '600' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 8,
  },
  emptyBody: {
    color: Colors.dark.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
