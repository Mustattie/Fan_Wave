import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  UserPlus, Tent, UsersRound, Video, Share2, LogIn, Activity,
} from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { FilterPillRow } from '@/components/FilterPillRow';
import { useActivityFeed } from '@/hooks/useAdminData';

const FILTERS = ['All', 'Sign Ups', 'Parties', 'Groups', 'Clips', 'Shares'];
const FILTER_MAP: Record<string, string | null> = {
  All: null,
  'Sign Ups': 'sign_up',
  Parties: 'watch_party',
  Groups: 'group',
  Clips: 'clip',
  Shares: 'share',
};

const EVENT_ICON: Record<string, React.ReactNode> = {
  sign_up: <UserPlus size={16} color={Colors.dark.accent} />,
  sign_in: <LogIn size={16} color={Colors.dark.textSecondary} />,
  watch_party_created: <Tent size={16} color="#ff8c00" />,
  watch_party_rsvp: <Tent size={16} color={Colors.dark.warning} />,
  group_created: <UsersRound size={16} color={Colors.dark.accentLight} />,
  group_joined: <UsersRound size={16} color={Colors.dark.accentLight} />,
  clip_uploaded: <Video size={16} color={Colors.dark.success} />,
  clip_liked: <Video size={16} color={Colors.dark.success} />,
  content_shared: <Share2 size={16} color={Colors.dark.textSecondary} />,
};

function eventIcon(name: string) {
  return EVENT_ICON[name] ?? <Activity size={16} color={Colors.dark.textMuted} />;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdminActivity() {
  const [filter, setFilter] = useState('All');
  const activeFilter = FILTER_MAP[filter];
  const { data, isLoading } = useActivityFeed(100, 0, activeFilter);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FilterPillRow items={FILTERS} activeItem={filter} onSelect={setFilter} />

      {isLoading ? (
        <ActivityIndicator color={Colors.dark.accent} style={styles.loader} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.event_id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.iconWrap}>{eventIcon(item.event_name)}</View>
              <View style={styles.info}>
                <Text style={styles.eventName}>
                  {item.event_name.replace(/_/g, ' ')}
                </Text>
                <Text style={styles.user}>{item.user_display}</Text>
                {item.screen && (
                  <Text style={styles.screen}>Screen: {item.screen}</Text>
                )}
              </View>
              <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No activity events found.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  loader: { marginTop: 40 },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 6 },
  row: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: Colors.dark.surface, borderRadius: 10,
    padding: 12, gap: 10,
    borderWidth: 1, borderColor: Colors.dark.border,
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: Colors.dark.surfaceLight,
    alignItems: 'center', justifyContent: 'center',
  },
  info: { flex: 1 },
  eventName: { fontSize: 13, fontWeight: '600', color: Colors.dark.text, textTransform: 'capitalize' },
  user: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 2 },
  screen: { fontSize: 11, color: Colors.dark.textMuted, marginTop: 1 },
  time: { fontSize: 11, color: Colors.dark.textMuted },
  empty: { color: Colors.dark.textMuted, fontSize: 14, textAlign: 'center', marginTop: 40 },
});
