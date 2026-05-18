import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Info,
  Send,
  Image as ImageIcon,
  Smile,
  Users,
  Share2,
} from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/errorReporting';
import { subscribeToMessages, subscribeToPresence } from '@/lib/realtime';
import {
  mapChatRoomToDisplay,
  mapMessageToDisplay,
  type ChatRoomDisplay,
  type ChatMessageDisplay,
} from '@/lib/mappers';
import MomentsFeed from '@/components/MomentsFeed';

type SubTab = 'Chat' | 'Highlights';
const SUB_TABS: SubTab[] = ['Chat', 'Highlights'];
const PAGE_SIZE = 20;

export default function FanGroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessageDisplay[]>([]);
  const [activeTab, setActiveTab] = useState<SubTab>('Chat');
  const [onlineCount, setOnlineCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const scrollRef = useRef<FlatList>(null);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState('You');
  const [currentUserAvatar, setCurrentUserAvatar] = useState('A');

  const [group, setGroup] = useState<ChatRoomDisplay | null>(null);

  // Load auth user
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setCurrentUserId(user.id);
          const displayName = user.user_metadata?.display_name || user.email || 'You';
          setCurrentUserName(displayName);
          setCurrentUserAvatar(displayName.charAt(0).toUpperCase());
        }
      } catch (e) {
        reportError(e, { source: 'fan-group:loadAuthUser' });
      }
    })();
  }, []);

  // Load group data from Supabase
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoadingGroup(true);
      try {
        const { data, error } = await supabase
          .from('chat_rooms')
          .select('*')
          .eq('id', id)
          .single();

        if (error) throw error;
        if (data) {
          setGroup(mapChatRoomToDisplay(data));
        }
      } catch {
        // Group not found
      } finally {
        setLoadingGroup(false);
      }
    })();
  }, [id]);

  // Load initial messages from Supabase
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoadingMessages(true);
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('chat_room_id', id)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE);

        if (error) throw error;
        if (data && data.length > 0) {
          const mapped = data.reverse().map((row: any) => mapMessageToDisplay(row, currentUserId || undefined));
          setMessages(mapped);
          setHasMore(data.length === PAGE_SIZE);
        } else {
          setMessages([]);
          setHasMore(false);
        }
      } catch {
        setMessages([]);
        setHasMore(false);
      } finally {
        setLoadingMessages(false);
      }
    })();
  }, [id, currentUserId]);

  // Realtime: new messages
  useEffect(() => {
    if (!id) return;
    const unsub = subscribeToMessages(id, (newRow) => {
      // Avoid duplicating our own optimistic messages
      const incoming = mapMessageToDisplay(newRow, currentUserId || undefined);
      if (!incoming.isMe) {
        setMessages((prev) => [...prev, incoming]);
      }
    });
    return unsub;
  }, [id, currentUserId]);

  // Realtime: presence
  useEffect(() => {
    if (!id) return;
    const unsub = subscribeToPresence(
      `presence-${id}`,
      (state) => {
        setOnlineCount(Object.keys(state).length);
      },
      { user_id: currentUserId || 'anon', online_at: new Date().toISOString() },
    );
    return unsub;
  }, [id, currentUserId]);

  // Paginated message loading
  const loadMoreMessages = useCallback(async () => {
    if (loadingMore || !hasMore || !id) return;

    setLoadingMore(true);
    try {
      const oldestMessage = messages[0];
      const { data, error } = await supabase
        .from('messages')
        .select('*, user:users!user_id(*)')
        .eq('chat_room_id', id)
        .lt('created_at', oldestMessage?.created_at ?? new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      if (!data || data.length === 0) {
        setHasMore(false);
      } else {
        const olderMessages = data.reverse().map((row: any) =>
          mapMessageToDisplay(row, currentUserId || undefined)
        );
        if (data.length < PAGE_SIZE) setHasMore(false);
        setMessages((prev) => [...olderMessages, ...prev]);
      }
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, id, messages, currentUserId]);

  // Send message
  const handleSend = async () => {
    if (!message.trim() || !id) return;

    const newMsg: ChatMessageDisplay = {
      id: `m-${Date.now()}`,
      user: 'You',
      avatar: currentUserAvatar,
      avatarBg: Colors.dark.accent,
      text: message.trim(),
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      created_at: new Date().toISOString(),
      isMe: true,
    };

    setMessages((prev) => [...prev, newMsg]);
    setMessage('');
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const { error } = await supabase.from('messages').insert({
        chat_room_id: id,
        user_id: currentUserId,
        content: newMsg.text,
      });
      if (error) {
        // If member check fails, auto-join and retry
        if (error.message.includes('policy') || error.message.includes('member')) {
          await supabase.from('chat_room_members').insert({
            chat_room_id: id,
            user_id: currentUserId,
            role: 'member',
          });
          await supabase.from('messages').insert({
            chat_room_id: id,
            user_id: currentUserId,
            content: newMsg.text,
          });
        } else {
          throw error;
        }
      }
    } catch {
      // Remove optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== newMsg.id));
    }
  };

  const displayedOnlineCount = onlineCount || group?.onlineCount || 0;

  const renderMessage = ({ item }: { item: ChatMessageDisplay }) => (
    <View
      style={[
        styles.messageBubbleRow,
        item.isMe && styles.messageBubbleRowMe,
      ]}
    >
      {!item.isMe && (
        <View style={[styles.chatAvatar, { backgroundColor: item.avatarBg }]}>
          <Text style={styles.chatAvatarText}>{item.avatar}</Text>
        </View>
      )}
      <View style={styles.messageContent}>
        {!item.isMe && (
          <Text style={styles.messageUser}>{item.user}</Text>
        )}
        <View
          style={[
            styles.bubble,
            item.isMe ? styles.bubbleMe : styles.bubbleOther,
          ]}
        >
          <Text style={[styles.bubbleText, item.isMe && styles.bubbleTextMe]}>
            {item.text}
          </Text>
        </View>
        <Text style={[styles.messageTime, item.isMe && styles.messageTimeMe]}>
          {item.time}
        </Text>
      </View>
    </View>
  );

  const renderLoadingHeader = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.loadingMore}>
        <ActivityIndicator size="small" color={Colors.dark.accent} />
        <Text style={styles.loadingMoreText}>Loading...</Text>
      </View>
    );
  };

  if (loadingGroup) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={24} color={Colors.dark.text} />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={styles.headerName}>Group not found</Text>
          </View>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: Colors.dark.textSecondary }}>This group doesn't exist</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <View style={[styles.headerIcon, { backgroundColor: group.iconBg }]}>
          <Text style={styles.headerIconText}>{group.icon}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>
            {group.name}
          </Text>
          <Text style={styles.headerMeta}>
            {group.memberCount.toLocaleString()} members ·{' '}
            <Text style={styles.onlineText}>{displayedOnlineCount} online</Text>
          </Text>
        </View>
        <TouchableOpacity style={styles.infoBtn} onPress={async () => {
          const { shareGroup } = await import('@/lib/sharing');
          if (group) await shareGroup({ id: group.id, name: group.name, memberCount: group.memberCount });
        }}>
          <Share2 size={20} color={Colors.dark.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.infoBtn}>
          <Users size={20} color={Colors.dark.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.infoBtn}>
          <Info size={20} color={Colors.dark.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Pinned Event Banner */}
      <View style={styles.pinnedBanner}>
        <Text style={styles.pinnedIcon}>{group.icon}</Text>
        <View style={styles.pinnedInfo}>
          <Text style={styles.pinnedTitle}>{group.name}</Text>
          <Text style={styles.pinnedMeta}>
            {group.memberCount.toLocaleString()} members · {group.tags?.join(' · ') || ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.pinnedRsvp}>
          <Text style={styles.pinnedRsvpText}>Share</Text>
        </TouchableOpacity>
      </View>

      {/* Sub-Tabs */}
      <View style={styles.subTabRow}>
        {SUB_TABS.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.subTab, isActive && styles.subTabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.subTabText, isActive && styles.subTabTextActive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Tab Content */}
      {activeTab === 'Chat' ? (
        <View style={{ flex: 1, marginBottom: keyboardHeight }}>
          {loadingMessages ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator size="large" color={Colors.dark.accent} />
            </View>
          ) : (
            <FlatList
              ref={scrollRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.messageList}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() =>
                scrollRef.current?.scrollToEnd({ animated: false })
              }
              ListHeaderComponent={renderLoadingHeader}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <Text style={{ color: Colors.dark.textSecondary }}>
                    No messages yet — start the conversation!
                  </Text>
                </View>
              }
              onScroll={({ nativeEvent }) => {
                if (nativeEvent.contentOffset.y <= 0 && hasMore && !loadingMore) {
                  loadMoreMessages();
                }
              }}
              scrollEventThrottle={400}
            />
          )}

          {/* Input Bar — keyboard avoidance handled by parent marginBottom */}
          <View
            style={[
              styles.inputBar,
              { paddingBottom: 10 + (keyboardHeight > 0 ? 0 : insets.bottom) },
            ]}
          >
            <TouchableOpacity style={styles.inputAction}>
              <ImageIcon size={20} color={Colors.dark.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inputAction}>
              <Smile size={20} color={Colors.dark.textMuted} />
            </TouchableOpacity>
            <TextInput
              style={styles.textInput}
              placeholder="Message..."
              placeholderTextColor={Colors.dark.textMuted}
              value={message}
              onChangeText={setMessage}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              maxLength={2000}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                !message.trim() && styles.sendButtonDisabled,
              ]}
              onPress={handleSend}
              disabled={!message.trim()}
            >
              <Send size={18} color={message.trim() ? '#fff' : Colors.dark.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <MomentsFeed chatRoomId={id || ''} sportId={group.sport || 'nfl'} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.dark.border, gap: 8,
  },
  backBtn: { padding: 4 },
  headerIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerIconText: { fontSize: 18 },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 16, fontWeight: '700', color: Colors.dark.text },
  headerMeta: { fontSize: 12, color: Colors.dark.textSecondary },
  onlineText: { color: Colors.dark.success },
  infoBtn: { padding: 6 },
  pinnedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 12, marginVertical: 8, padding: 12,
    backgroundColor: Colors.dark.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.dark.accent + '44',
  },
  pinnedIcon: { fontSize: 24 },
  pinnedInfo: { flex: 1 },
  pinnedTitle: { fontSize: 13, fontWeight: '700', color: Colors.dark.text },
  pinnedMeta: { fontSize: 11, color: Colors.dark.textSecondary, marginTop: 2 },
  pinnedRsvp: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.dark.accent },
  pinnedRsvpText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  subTabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.dark.border },
  subTab: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  subTabActive: { borderBottomColor: Colors.dark.accent },
  subTabText: { fontSize: 13, fontWeight: '600', color: Colors.dark.textSecondary },
  subTabTextActive: { color: '#ffffff' },
  messageList: { paddingHorizontal: 12, paddingVertical: 8 },
  messageBubbleRow: { flexDirection: 'row', marginBottom: 12, alignItems: 'flex-end', gap: 8 },
  messageBubbleRowMe: { flexDirection: 'row-reverse' },
  chatAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  chatAvatarText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  messageContent: { maxWidth: '75%' },
  messageUser: { fontSize: 11, fontWeight: '600', color: Colors.dark.textSecondary, marginBottom: 3, marginLeft: 4 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleOther: { backgroundColor: Colors.dark.surface, borderBottomLeftRadius: 4 },
  bubbleMe: { backgroundColor: Colors.dark.accent, borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 14, color: Colors.dark.text, lineHeight: 20 },
  bubbleTextMe: { color: '#fff' },
  messageTime: { fontSize: 10, color: Colors.dark.textMuted, marginTop: 3, marginLeft: 4 },
  messageTimeMe: { textAlign: 'right', marginRight: 4, marginLeft: 0 },
  loadingMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 8 },
  loadingMoreText: { fontSize: 12, color: Colors.dark.textSecondary },
  inputBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: Colors.dark.border, backgroundColor: Colors.dark.tabBar,
  },
  inputAction: { padding: 4 },
  textInput: {
    flex: 1, backgroundColor: Colors.dark.surface, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 14,
    color: Colors.dark.text, borderWidth: 1, borderColor: Colors.dark.border,
  },
  sendButton: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.dark.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: Colors.dark.surface },
});
