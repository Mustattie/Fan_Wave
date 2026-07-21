import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/errorReporting';
import type { ChatRoomDisplay } from '@/lib/mappers';

interface GroupCardProps {
  group: ChatRoomDisplay;
  onPress?: () => void;
  showUnread?: boolean;
  // v8.7+ P0: surfaces like Discover "Trending Groups", Home "Suggested
  // Groups", and Soccer Cup → Fan Groups need a Join CTA inline on the
  // card so fans can actually join without navigating into the group
  // detail screen first. Previously GroupCard had no Join affordance,
  // which the user flagged in v8.7 UAT: "How then can interested fans
  // join these fan groups if there is no join button". The default stays
  // false so existing surfaces (My Groups, chat-list) don't change.
  joinable?: boolean;
  isMember?: boolean;
  onJoinSuccess?: (groupId: string) => void;
}

export function GroupCard({
  group,
  onPress,
  showUnread = true,
  joinable = false,
  isMember = false,
  onJoinSuccess,
}: GroupCardProps) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [joinedLocally, setJoinedLocally] = useState(false);

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      router.push(`/fan-group/${group.id}`);
    }
  };

  // v8.7+: client-side Join handler. Mirrors the Groups tab Discover
  // section flow (app/(tabs)/groups.tsx:281–352) but inlined on the card
  // so any consumer (Discover, Home, future surfaces) gets the same CTA
  // without reimplementing the insert/RLS-error logic.
  const handleJoin = async (e: any) => {
    // Stop the press bubbling to the card-level navigation.
    e?.stopPropagation?.();
    if (joining || joinedLocally || isMember) return;
    setJoining(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Sign in required', 'Please sign in to join a group.');
        return;
      }
      const { error } = await supabase.from('chat_room_members').insert({
        chat_room_id: group.id,
        user_id: user.id,
        role: 'member',
      });
      if (error) {
        const code: string | undefined = (error as any)?.code;
        const msg: string = (error.message ?? '').toLowerCase();
        const isDup = code === '23505' || msg.includes('duplicate');
        if (isDup) {
          // Already a member — treat as success (idempotent join).
          setJoinedLocally(true);
          onJoinSuccess?.(group.id);
        } else {
          // Report the raw error so future 42501s can be diagnosed
          // (v9.1 UAT hit "Could not join" on WC-typed suggested groups
          // still gated by mig 053 chat_room_members_insert). The user-
          // facing alert stays neutral; the paywall belongs at onboarding.
          reportError(error, { source: 'GroupCard:join', groupId: group.id, code, msg });
          Alert.alert('Could not join', 'Please try again.');
        }
        return;
      }
      setJoinedLocally(true);
      onJoinSuccess?.(group.id);
    } catch {
      Alert.alert('Could not join', 'Please try again.');
    } finally {
      setJoining(false);
    }
  };

  const showJoinedState = isMember || joinedLocally;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        showUnread && (group.unreadCount ?? 0) > 0 && styles.cardUnread,
      ]}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: group.iconBg }]}>
          <Text style={styles.iconText}>{group.icon}</Text>
        </View>
        <View style={styles.info}>
          {/* v9.1 UAT 2026-07-21: on the 240px Suggested carousel tile the
              Join button used to sit inside this row and squeezed the name
              column to ~70px, so "Denver Broncos Fans" truncated to
              "Denver Broncos…". When joinable, the Join button is now
              hoisted below member count so the name gets the full row
              width minus the 44px icon. */}
          <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
            {group.name}
          </Text>
          <Text style={styles.members}>
            {(group.memberCount ?? 0).toLocaleString()} members
            {(group.onlineCount ?? 0) > 0 && ` · ${group.onlineCount ?? 0} online`}
          </Text>
        </View>
        {!joinable && showUnread && (
          <View style={styles.rightColumn}>
            <Text style={styles.time}>{group.lastMessageTime}</Text>
            {(group.unreadCount ?? 0) > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{group.unreadCount ?? 0}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {joinable && (
        <TouchableOpacity
          style={[styles.joinBtn, styles.joinBtnFullWidth, showJoinedState && styles.joinedBtn]}
          onPress={handleJoin}
          disabled={joining || showJoinedState}
          activeOpacity={0.85}
        >
          {joining ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[styles.joinBtnText, showJoinedState && styles.joinedBtnText]}>
              {showJoinedState ? '✓ Joined' : 'Join'}
            </Text>
          )}
        </TouchableOpacity>
      )}

      {group.lastMessage ? (
        <Text style={styles.preview} numberOfLines={1}>
          {group.lastMessage}
        </Text>
      ) : null}

      {group.tags && group.tags.length > 0 && (
        <View style={styles.tagRow}>
          {group.tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  cardUnread: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.dark.accent,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 22,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  members: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 1,
  },
  rightColumn: {
    alignItems: 'flex-end',
  },
  time: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  badge: {
    backgroundColor: Colors.dark.accent,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  preview: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
  tagRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: Colors.dark.surfaceLight,
  },
  tagText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  joinBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.dark.accent,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBtnFullWidth: {
    marginTop: 6,
    alignSelf: 'stretch',
    paddingVertical: 10,
  },
  joinedBtn: {
    backgroundColor: Colors.dark.surface,
    borderWidth: 1.5,
    borderColor: Colors.dark.success,
  },
  joinBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  joinedBtnText: {
    color: Colors.dark.success,
  },
});
