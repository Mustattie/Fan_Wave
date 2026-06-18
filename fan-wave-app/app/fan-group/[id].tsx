import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import * as Contacts from 'expo-contacts';
import {
  loadContactsWithPhones,
  pickPhoneForContact,
  openSmsInvite,
  buildGroupInviteBody,
} from '@/lib/inviteContacts';
import { X as XIcon, Users as UsersIcon } from 'lucide-react-native';
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
  // Membership state — drives the Join CTA banner. A user is "in the
  // group" if they own it OR they have a row in chat_room_members.
  const [isMember, setIsMember] = useState<boolean>(false);
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [joining, setJoining] = useState(false);

  // Invite sheet state (v8.3): two-option chooser between contacts-picker
  // SMS invite (reusing the create-private-group flow) and the system
  // share sheet (existing shareGroup helper). Contacts list shares the
  // helper in lib/inviteContacts.ts.
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsList, setContactsList] = useState<Contacts.ExistingContact[]>([]);

  const openInviteSheet = useCallback(() => setInviteSheetOpen(true), []);

  const handleInviteViaShare = useCallback(async () => {
    setInviteSheetOpen(false);
    const { shareGroup } = await import('@/lib/sharing');
    if (group) {
      await shareGroup({
        id: group.id,
        name: group.name,
        memberCount: group.memberCount,
      });
    }
  }, [group]);

  const handleInviteViaContacts = useCallback(async () => {
    setInviteSheetOpen(false);
    setContactPickerOpen(true);
    setContactsLoading(true);
    const list = await loadContactsWithPhones();
    if (list === null) {
      setContactPickerOpen(false);
      setContactsLoading(false);
      return;
    }
    setContactsList(list);
    setContactsLoading(false);
  }, []);

  const handlePickInviteContact = useCallback(
    async (contact: Contacts.Contact) => {
      if (!group) return;
      const picked = await pickPhoneForContact(contact);
      if (!picked) return;
      setContactPickerOpen(false);
      // Hand off to the device SMS composer (same path as the
      // create-private-group flow).
      await openSmsInvite(
        [picked],
        buildGroupInviteBody({ id: group.id, name: group.name }),
      );
    },
    [group],
  );

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
          // Owner check uses the raw row's owner_id, which the mapper
          // doesn't always preserve verbatim.
          const auth = await supabase.auth.getUser();
          const uid = auth.data.user?.id ?? null;
          setIsOwner(!!uid && data.owner_id === uid);
        }
      } catch {
        // Group not found
      } finally {
        setLoadingGroup(false);
      }
    })();
  }, [id]);

  // Membership check — separate query so it refreshes after Join
  useEffect(() => {
    if (!id || !currentUserId) return;
    (async () => {
      const { data } = await supabase
        .from('chat_room_members')
        .select('user_id')
        .eq('chat_room_id', id)
        .eq('user_id', currentUserId)
        .maybeSingle();
      setIsMember(!!data);
    })();
  }, [id, currentUserId]);

  const handleJoin = useCallback(async () => {
    if (!id || !currentUserId || joining) return;
    setJoining(true);
    try {
      const { error } = await supabase.from('chat_room_members').insert({
        chat_room_id: id,
        user_id: currentUserId,
        role: 'member',
      });
      if (error) throw error;
      setIsMember(true);
      // Bump local member count so the header reflects the join.
      setGroup((prev) =>
        prev ? { ...prev, memberCount: (prev.memberCount || 0) + 1 } : prev,
      );
    } catch (e: any) {
      reportError(e, { source: 'fan-group:handleJoin', groupId: id });
      Alert.alert(
        'Could not join',
        e?.message || 'Please try again in a moment.',
      );
    } finally {
      setJoining(false);
    }
  }, [id, currentUserId, joining]);

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

    // Rate limiter (FW-102): 60 messages per minute per user.
    if (currentUserId) {
      const { data: allowed } = await supabase.rpc('check_rate_limit', {
        p_user_id: currentUserId,
        p_action: 'message_send',
        p_max_count: 60,
        p_window_seconds: 60,
      });
      if (allowed === false) {
        // Silent throttle — feedback would interrupt typing. The rate
        // matches Slack/Discord's ceiling so legitimate users never hit it.
        return;
      }
    }

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
        {/* Share only surfaces once the user has joined. Pinned-banner
            Join CTA (below) is the canonical entry for non-members; the
            product rule is "you must be a member of a fan group before
            you can share it." */}
        {(isMember || isOwner) && (
          <TouchableOpacity style={styles.infoBtn} onPress={openInviteSheet}>
            <Share2 size={20} color={Colors.dark.textSecondary} />
          </TouchableOpacity>
        )}
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
        {!isOwner && !isMember ? (
          // Join CTA — matches the WC Soccer Cup fan group card pattern so
          // a visitor (coming in from Suggested Groups, a share link, or
          // any tap on a group card) has a one-tap way to join. Owner /
          // existing member never sees this.
          <TouchableOpacity
            style={styles.joinPinned}
            onPress={handleJoin}
            disabled={joining}
          >
            {joining ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.joinPinnedText}>Join</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.pinnedRsvp} onPress={openInviteSheet}>
            <Text style={styles.pinnedRsvpText}>Share</Text>
          </TouchableOpacity>
        )}
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

      {/* Tab Content — wrapped in KeyboardAvoidingView so the chat composer
          rides above the soft keyboard on devices that don't honour the
          app.json softwareKeyboardLayoutMode setting (notably Samsung One
          UI). behavior='padding' on iOS, 'height' on Android — both keep
          the FlatList visible and lift the input bar. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
      {activeTab === 'Chat' ? (
        <View style={{ flex: 1 }}>
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

          {/* Input Bar — KeyboardAvoidingView wrapping the whole tab lifts
              this bar above the keyboard; we just add safe-area bottom
              padding for when the keyboard is closed. */}
          <View
            style={[
              styles.inputBar,
              { paddingBottom: 10 + insets.bottom },
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
            {/* Sending chat in a group you're already a member of is free
                (migration 053). PaywallGate removed — DB allows it for any
                member. Creating groups + posting clips still gated. */}
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
          {/* sportId falls back to the moment-type 'default' bucket (Big
              Play / Highlight / Reaction / Discussion) for any group whose
              sport we can't resolve — NEVER 'nfl', which would surface
              Touchdown/Interception/Sack chips inside a Soccer Cup group
              (FW-7). Auto-join is delegated so MomentsFeed can ensure the
              poster is a chat_room_members row before INSERT — otherwise
              the RLS WITH CHECK silently rejects the row and the moment
              vanishes on tab switch (FW-5). */}
          <MomentsFeed
            chatRoomId={id || ''}
            sportId={group.sport || 'default'}
            isMember={isMember || isOwner}
            onEnsureMember={async () => {
              if (isMember || isOwner || !currentUserId || !id) return true;
              try {
                const { error } = await supabase
                  .from('chat_room_members')
                  .insert({ chat_room_id: id, user_id: currentUserId, role: 'member' });
                // Unique-violation = already a member (race); treat as success.
                if (error && !/duplicate|unique/i.test(error.message)) {
                  throw error;
                }
                setIsMember(true);
                setGroup((prev) =>
                  prev ? { ...prev, memberCount: (prev.memberCount || 0) + 1 } : prev,
                );
                return true;
              } catch (e) {
                reportError(e, { source: 'fan-group:onEnsureMember', groupId: id });
                return false;
              }
            }}
          />
        </View>
      )}
      </KeyboardAvoidingView>

      {/* Invite chooser sheet — two options: contacts picker (SMS deep
          link, mirrors create-private-group flow) and the existing
          system share sheet. */}
      <Modal
        visible={inviteSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setInviteSheetOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setInviteSheetOpen(false)}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite to group</Text>
              <TouchableOpacity onPress={() => setInviteSheetOpen(false)} hitSlop={10}>
                <XIcon size={22} color={Colors.dark.text} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.inviteRow} onPress={handleInviteViaContacts}>
              <View style={[styles.inviteIcon, { backgroundColor: Colors.dark.accent }]}>
                <UsersIcon size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.inviteRowLabel}>Pick from Contacts</Text>
                <Text style={styles.inviteRowSub}>Send an SMS invite with the group link</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.inviteRow} onPress={handleInviteViaShare}>
              <View style={[styles.inviteIcon, { backgroundColor: Colors.dark.surface }]}>
                <Share2 size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.inviteRowLabel}>Share via...</Text>
                <Text style={styles.inviteRowSub}>System share sheet</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Contact picker — reuses the same list/render pattern as groups.tsx */}
      <Modal
        visible={contactPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setContactPickerOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '75%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pick a contact</Text>
              <TouchableOpacity onPress={() => setContactPickerOpen(false)} hitSlop={10}>
                <XIcon size={22} color={Colors.dark.text} />
              </TouchableOpacity>
            </View>
            {contactsLoading ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator color={Colors.dark.accent} />
              </View>
            ) : (
              <FlatList
                data={contactsList}
                keyExtractor={(c) => c.id || c.name || Math.random().toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.contactRow}
                    onPress={() => handlePickInviteContact(item)}
                  >
                    <View style={styles.contactAvatar}>
                      <UsersIcon size={18} color={Colors.dark.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{item.name}</Text>
                      {item.phoneNumbers?.[0]?.number && (
                        <Text style={styles.contactPhone}>
                          {item.phoneNumbers[0].number}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyContactsText}>
                    No contacts with phone numbers found.
                  </Text>
                }
              />
            )}
          </View>
        </View>
      </Modal>
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
  joinPinned: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.dark.accentGreen,
    minWidth: 68,
    alignItems: 'center',
  },
  joinPinnedText: { fontSize: 13, fontWeight: '800', color: '#fff' },
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
  // Invite chooser + contact picker (v8.3)
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.dark.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.border,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginBottom: 4,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: Colors.dark.text },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  inviteIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  inviteRowLabel: { fontSize: 15, fontWeight: '700', color: Colors.dark.text },
  inviteRowSub: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 2 },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.border,
  },
  contactAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.dark.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  contactName: { fontSize: 14, fontWeight: '600', color: Colors.dark.text },
  contactPhone: { fontSize: 12, color: Colors.dark.textSecondary, marginTop: 2 },
  emptyContactsText: {
    textAlign: 'center',
    color: Colors.dark.textSecondary,
    paddingVertical: 40,
  },
});
