import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Share2 } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { shareGroup } from '@/lib/sharing';
import type { ChatRoomDisplay } from '@/lib/mappers';

interface GroupCardProps {
  group: ChatRoomDisplay;
  onPress?: () => void;
  showUnread?: boolean;
}

export function GroupCard({ group, onPress, showUnread = true }: GroupCardProps) {
  const router = useRouter();

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      router.push(`/fan-group/${group.id}`);
    }
  };

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
          <Text style={styles.name}>{group.name}</Text>
          <Text style={styles.members}>
            {(group.memberCount ?? 0).toLocaleString()} members
            {(group.onlineCount ?? 0) > 0 && ` · ${group.onlineCount ?? 0} online`}
          </Text>
        </View>
        {showUnread && (
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

      {group.lastMessage ? (
        <Text style={styles.preview} numberOfLines={1}>
          {group.lastMessage}
        </Text>
      ) : null}

      <View style={styles.bottomRow}>
        {group.tags && group.tags.length > 0 && (
          <View style={styles.tagRow}>
            {group.tags.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
        <TouchableOpacity
          style={styles.shareBtn}
          onPress={(e) => { e.stopPropagation(); shareGroup({ id: group.id, name: group.name, memberCount: group.memberCount }); }}
          activeOpacity={0.7}
        >
          <Share2 size={12} color={Colors.dark.textSecondary} />
        </TouchableOpacity>
      </View>
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
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shareBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: Colors.dark.surfaceLight,
  },
});
