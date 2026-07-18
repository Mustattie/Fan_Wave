import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { X, Send, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/errorReporting';
import { isExpoGo } from '@/lib/entitlements';

interface ClipCommentRow {
  id: string;
  clip_id: string;
  user_id: string;
  content: string;
  created_at: string;
  author_name: string;
  isOwn: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  clipId: string | null;
  onCountChange?: (next: number) => void;
}

const C = Colors.dark;

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ClipCommentsSheet({ visible, onClose, clipId, onCountChange }: Props) {
  const [comments, setComments] = useState<ClipCommentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [posting, setPosting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Parent (clips.tsx:985) passes onCountChange as an inline lambda that
  // recreates every render. Putting it in loadComments' deps used to cause
  // an infinite refetch loop: load -> setState -> parent re-render -> new
  // onCountChange -> new loadComments -> effect re-fires -> load again ->
  // spinner never resolves, screen appears to spiral/flicker.
  // Ref pattern captures the latest without destabilizing loadComments.
  const onCountChangeRef = useRef(onCountChange);
  useEffect(() => {
    onCountChangeRef.current = onCountChange;
  }, [onCountChange]);

  const loadComments = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUserId(user?.id ?? null);

      const { data, error } = await supabase
        .from('clip_comments')
        .select('id, clip_id, user_id, content, created_at')
        .eq('clip_id', id)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) {
        reportError(error, { source: 'ClipCommentsSheet:load', clipId: id });
        setComments([]);
        return;
      }

      const rows = data ?? [];
      // Resolve display names in a single follow-up query so we don't need
      // a server-side FK join. clip_comments.user_id references auth.uid;
      // public.users.auth_id is the bridge column.
      const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
      const nameByAuthId = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('auth_id, display_name')
          .in('auth_id', userIds);
        for (const u of users ?? []) {
          if (u.auth_id) {
            nameByAuthId.set(u.auth_id, u.display_name || 'fan');
          }
        }
      }

      const decorated: ClipCommentRow[] = rows.map((r) => ({
        ...r,
        author_name: nameByAuthId.get(r.user_id) || 'fan',
        isOwn: !!user && r.user_id === user.id,
      }));
      setComments(decorated);
      onCountChangeRef.current?.(decorated.length);
    } catch (e) {
      reportError(e, { source: 'ClipCommentsSheet:load', clipId: id });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible && clipId) {
      loadComments(clipId);
    } else {
      setComments([]);
      setInput('');
    }
  }, [visible, clipId, loadComments]);

  // Realtime: pick up other users' new comments while the sheet is open.
  useEffect(() => {
    if (!visible || !clipId) return;
    const channel = supabase
      .channel(`clip-comments-${clipId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'clip_comments', filter: `clip_id=eq.${clipId}` },
        () => loadComments(clipId),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [visible, clipId, loadComments]);

  const submit = async () => {
    if (!clipId) return;
    const content = input.trim();
    if (!content) return;
    if (content.length > 500) {
      Alert.alert('Too long', 'Comments are limited to 500 characters.');
      return;
    }
    setPosting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Sign in required', 'Please sign in to post a comment.');
        return;
      }

      // Optimistic insert so the UI feels instant even on slow networks.
      const optimistic: ClipCommentRow = {
        id: `pending-${Date.now()}`,
        clip_id: clipId,
        user_id: user.id,
        content,
        created_at: new Date().toISOString(),
        author_name: 'You',
        isOwn: true,
      };
      setComments((prev) => [optimistic, ...prev]);
      setInput('');

      const { error, data } = await supabase
        .from('clip_comments')
        .insert({ clip_id: clipId, user_id: user.id, content })
        .select('id, created_at')
        .single();

      if (error) {
        // In Expo Go RLS may reject — keep the optimistic entry but warn so
        // the user knows the action didn't persist for other devices.
        if (isExpoGo()) {
          // Stop spinning; let the optimistic comment stay visible.
          return;
        }
        reportError(error, { source: 'ClipCommentsSheet:insert', clipId });
        setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
        setInput(content);
        Alert.alert('Could not post', error.message);
        return;
      }

      if (data) {
        setComments((prev) => {
          const next = prev.map((c) =>
            c.id === optimistic.id ? { ...c, id: data.id, created_at: data.created_at } : c,
          );
          onCountChangeRef.current?.(next.length);
          return next;
        });
      }
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = (commentId: string) => {
    Alert.alert(
      'Delete comment',
      'Remove this comment?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const prev = comments;
            setComments((cs) => cs.filter((c) => c.id !== commentId));
            const { error } = await supabase
              .from('clip_comments')
              .delete()
              .eq('id', commentId);
            if (error) {
              setComments(prev);
              Alert.alert('Could not delete', error.message);
            }
          },
        },
      ],
    );
  };

  const renderRow = ({ item }: { item: ClipCommentRow }) => (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{(item.author_name || 'F').charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.bubble}>
        <View style={styles.bubbleHeader}>
          <Text style={styles.author}>{item.isOwn ? 'You' : `@${item.author_name}`}</Text>
          <Text style={styles.timestamp}>{formatRelativeTime(item.created_at)}</Text>
        </View>
        <Text style={styles.content}>{item.content}</Text>
      </View>
      {item.isOwn && !item.id.startsWith('pending-') && (
        <TouchableOpacity onPress={() => handleDelete(item.id)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Trash2 size={14} color={C.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheet}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Comments</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
              <X size={20} color={C.text} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator color={C.accent} />
            </View>
          ) : (
            <FlatList
              data={comments}
              keyExtractor={(c) => c.id}
              renderItem={renderRow}
              contentContainerStyle={comments.length === 0 ? styles.emptyContent : styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyBlock}>
                  <Text style={styles.emptyTitle}>No comments yet</Text>
                  <Text style={styles.emptySub}>Be the first to react.</Text>
                </View>
              }
              keyboardShouldPersistTaps="handled"
            />
          )}

          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="Add a comment..."
              placeholderTextColor={C.textMuted}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={500}
              editable={!posting}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || posting) && styles.sendBtnDisabled]}
              onPress={submit}
              disabled={!input.trim() || posting}
            >
              {posting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Send size={18} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '80%',
    minHeight: '50%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: C.text,
  },
  loadingBlock: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  listContent: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  emptyBlock: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    marginBottom: 4,
  },
  emptySub: {
    fontSize: 13,
    color: C.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: `${C.accent}30`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: C.accent,
    fontWeight: '700',
    fontSize: 13,
  },
  bubble: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  author: {
    fontSize: 13,
    fontWeight: '700',
    color: C.text,
  },
  timestamp: {
    fontSize: 11,
    color: C.textMuted,
  },
  content: {
    fontSize: 14,
    color: C.text,
    lineHeight: 19,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.surface,
  },
  input: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    minHeight: 36,
    maxHeight: 110,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: C.background,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
