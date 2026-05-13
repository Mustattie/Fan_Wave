import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { getMyBlocks, unblockUser, type BlockedUser } from '@/lib/blocks';

const AVATAR_COLORS = ['#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c'];

export default function BlockedUsersScreen() {
  const router = useRouter();
  const [blocks, setBlocks] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await getMyBlocks();
    setBlocks(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleUnblock = (item: BlockedUser) => {
    Alert.alert(
      'Unblock user',
      `Unblock ${item.display_name}? Their posts and messages will reappear in your feeds.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          style: 'destructive',
          onPress: async () => {
            setBusyId(item.blocked_id);
            const ok = await unblockUser(item.blocked_id);
            setBusyId(null);
            if (ok) {
              setBlocks((prev) => prev.filter((b) => b.blocked_id !== item.blocked_id));
            } else {
              Alert.alert('Could not unblock', 'Please try again.');
            }
          },
        },
      ],
    );
  };

  const renderItem = ({ item, index }: { item: BlockedUser; index: number }) => {
    const initial = item.display_name.charAt(0).toUpperCase();
    const color = AVATAR_COLORS[index % AVATAR_COLORS.length];
    const isBusy = busyId === item.blocked_id;
    return (
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: color }]}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{item.display_name}</Text>
          <Text style={styles.meta}>
            Blocked {new Date(item.blocked_at).toLocaleDateString()}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.unblockBtn, isBusy && { opacity: 0.6 }]}
          onPress={() => handleUnblock(item)}
          disabled={isBusy}
        >
          <Text style={styles.unblockText}>{isBusy ? '…' : 'Unblock'}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Blocked Users</Text>
        <View style={styles.headerBtn} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      ) : blocks.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No blocked users</Text>
          <Text style={styles.emptyBody}>
            When you block someone, you and they will no longer see each other&apos;s
            posts, clips, watch parties, or messages.
          </Text>
        </View>
      ) : (
        <FlatList
          data={blocks}
          keyExtractor={(item) => item.blocked_id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingVertical: 8 }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  headerBtn: { padding: 6, minWidth: 36 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.dark.text },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.dark.border,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  name: { fontSize: 15, fontWeight: '600', color: Colors.dark.text },
  meta: { fontSize: 12, color: Colors.dark.textMuted, marginTop: 2 },
  unblockBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
  },
  unblockText: { fontSize: 13, fontWeight: '700', color: Colors.dark.accent },
});
