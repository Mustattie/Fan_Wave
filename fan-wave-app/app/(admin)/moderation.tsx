import React from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Flag, CheckCircle, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { useModerationQueue } from '@/hooks/useAdminData';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';

const REASON_COLOR: Record<string, string> = {
  spam: Colors.dark.warning,
  inappropriate: Colors.dark.error,
  harassment: Colors.dark.error,
  misleading: '#ff8c00',
  safety: Colors.dark.error,
  other: Colors.dark.textMuted,
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdminModeration() {
  const { data, isLoading, refetch } = useModerationQueue(100);
  const qc = useQueryClient();

  const handleAction = (flagId: string, contentType: string, contentId: string, action: 'dismiss' | 'remove') => {
    const label = action === 'remove' ? 'Remove Content' : 'Dismiss Flag';
    const msg = action === 'remove'
      ? 'This will mark the content as removed and cannot be undone.'
      : 'This will dismiss the flag without removing the content.';

    Alert.alert(label, msg, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: label,
        style: action === 'remove' ? 'destructive' : 'default',
        onPress: async () => {
          const { error } = await supabase.rpc('admin_moderate_content', {
            p_flag_id: flagId,
            p_action: action,
            p_content_type: contentType,
            p_content_id: contentId,
          });
          if (error) {
            Alert.alert('Error', error.message);
          } else {
            qc.invalidateQueries({ queryKey: ['admin', 'moderationQueue'] });
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {isLoading ? (
        <ActivityIndicator color={Colors.dark.accent} style={styles.loader} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => item.flag_id}
          contentContainerStyle={styles.list}
          onRefresh={refetch}
          refreshing={isLoading}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.typeBadge}>
                  <Flag size={12} color={Colors.dark.error} />
                  <Text style={styles.typeText}>{item.content_type.replace(/_/g, ' ')}</Text>
                </View>
                <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
              </View>

              <View style={styles.reasonRow}>
                <View style={[styles.reasonDot, { backgroundColor: REASON_COLOR[item.reason] ?? Colors.dark.textMuted }]} />
                <Text style={styles.reason}>{item.reason}</Text>
                <Text style={styles.flagCount}>{item.flag_count} flag{item.flag_count !== 1 ? 's' : ''}</Text>
              </View>

              {item.details && (
                <Text style={styles.details} numberOfLines={2}>{item.details}</Text>
              )}

              <Text style={styles.flagger}>Reported by {item.flagger_display}</Text>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.dismissBtn}
                  onPress={() => handleAction(item.flag_id, item.content_type, item.content_id, 'dismiss')}
                >
                  <CheckCircle size={14} color={Colors.dark.success} />
                  <Text style={styles.dismissText}>Dismiss</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => handleAction(item.flag_id, item.content_type, item.content_id, 'remove')}
                >
                  <Trash2 size={14} color={Colors.dark.error} />
                  <Text style={styles.removeText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <CheckCircle size={48} color={Colors.dark.success} />
              <Text style={styles.emptyTitle}>Queue is clear</Text>
              <Text style={styles.emptySub}>No flagged content to review.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  loader: { marginTop: 40 },
  list: { padding: 16, gap: 10 },
  card: {
    backgroundColor: Colors.dark.surface, borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: Colors.dark.border,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,68,68,0.15)',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
  },
  typeText: { fontSize: 11, fontWeight: '700', color: Colors.dark.error, textTransform: 'capitalize' },
  time: { fontSize: 11, color: Colors.dark.textMuted },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  reasonDot: { width: 8, height: 8, borderRadius: 4 },
  reason: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.dark.text, textTransform: 'capitalize' },
  flagCount: { fontSize: 12, color: Colors.dark.textSecondary, fontWeight: '600' },
  details: { fontSize: 13, color: Colors.dark.textSecondary, marginBottom: 6, fontStyle: 'italic' },
  flagger: { fontSize: 12, color: Colors.dark.textMuted, marginBottom: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  dismissBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(0,200,83,0.12)',
    paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.dark.success,
  },
  dismissText: { fontSize: 13, fontWeight: '700', color: Colors.dark.success },
  removeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(255,68,68,0.12)',
    paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.dark.error,
  },
  removeText: { fontSize: 13, fontWeight: '700', color: Colors.dark.error },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.dark.text },
  emptySub: { fontSize: 14, color: Colors.dark.textSecondary },
});
