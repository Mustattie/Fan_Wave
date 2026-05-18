import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Video, Film, X, Share2, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { getMomentTypesForSport, REACTION_EMOJIS } from '@/constants/MomentTypes';
import type { MomentType } from '@/constants/MomentTypes';
import { supabase } from '@/lib/supabase';

interface Reaction {
  emoji: string;
  count: number;
  reacted: boolean;
}

interface Moment {
  id: string;
  momentTypeId: string;
  user: string;
  comment: string;
  time: string;
  reactions: Reaction[];
  clipUri?: string;
  clipType?: 'video' | 'image';
}

interface MomentsFeedProps {
  chatRoomId: string;
  sportId: string;
}


export default function MomentsFeed({ chatRoomId, sportId }: MomentsFeedProps) {
  const insets = useSafeAreaInsets();
  const [moments, setMoments] = useState<Moment[]>([]);
  const [showPostModal, setShowPostModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<MomentType | null>(null);
  const [commentText, setCommentText] = useState('');
  const [clipUri, setClipUri] = useState<string | null>(null);
  const [clipType, setClipType] = useState<'video' | 'image' | null>(null);

  const pickClip = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your media library to attach clips.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos', 'images'],
      allowsEditing: true,
      quality: 0.8,
      videoMaxDuration: 30,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setClipUri(asset.uri);
      setClipType(asset.type === 'video' ? 'video' : 'image');
    }
  };

  const recordClip = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow camera access to record clips.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      allowsEditing: true,
      quality: 0.8,
      videoMaxDuration: 30,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setClipUri(asset.uri);
      setClipType('video');
    }
  };

  const momentTypes = getMomentTypesForSport(sportId);

  const getMomentType = (typeId: string): MomentType | undefined => {
    return momentTypes.find((t) => t.id === typeId) || {
      id: typeId,
      label: typeId,
      emoji: '⚡',
      color: '#ffc107',
    };
  };

  const toggleReaction = (momentId: string, emoji: string) => {
    setMoments((prev) =>
      prev.map((m) => {
        if (m.id !== momentId) return m;
        const existing = m.reactions.find((r) => r.emoji === emoji);
        if (existing) {
          return {
            ...m,
            reactions: m.reactions.map((r) =>
              r.emoji === emoji
                ? {
                    ...r,
                    count: r.reacted ? r.count - 1 : r.count + 1,
                    reacted: !r.reacted,
                  }
                : r,
            ).filter((r) => r.count > 0),
          };
        } else {
          return {
            ...m,
            reactions: [...m.reactions, { emoji, count: 1, reacted: true }],
          };
        }
      }),
    );
  };

  const addReactionFromPicker = (momentId: string, emoji: string) => {
    toggleReaction(momentId, emoji);
    setShowEmojiPicker(null);
  };

  const handleDeleteMoment = (momentId: string) => {
    Alert.alert(
      'Delete Moment',
      "Delete this moment? This can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setMoments((prev) => prev.filter((m) => m.id !== momentId));
            // Best-effort DB delete — only server-backed moments will match.
            // RLS scopes delete to the owner (user_id = auth.uid()).
            try {
              await supabase
                .from('match_moments')
                .delete()
                .eq('id', momentId);
            } catch {
              // Local-only moment; state removal is enough.
            }
          },
        },
      ],
    );
  };

  const handlePost = async () => {
    if (!selectedType || !commentText.trim()) return;

    const newMoment: Moment = {
      id: `mo-${Date.now()}`,
      momentTypeId: selectedType.id,
      user: 'You',
      comment: commentText.trim(),
      time: 'Just now',
      reactions: [],
      clipUri: clipUri || undefined,
      clipType: clipType || undefined,
    };

    setMoments((prev) => [newMoment, ...prev]);
    setShowPostModal(false);
    setSelectedType(null);
    setCommentText('');
    setClipUri(null);
    setClipType(null);

    try {
      await supabase.from('match_moments').insert({
        chat_room_id: chatRoomId,
        moment_type: selectedType.id,
        sport_id: sportId,
        user_name: 'You',
        comment: newMoment.comment,
      });
    } catch {
      // Graceful fallback — moment already added locally
    }
  };

  const renderMomentCard = ({ item }: { item: Moment }) => {
    const type = getMomentType(item.momentTypeId);
    return (
      <View style={styles.momentCard}>
        <View style={styles.momentHeader}>
          <View style={[styles.typeBadge, { backgroundColor: type?.color + '22' }]}>
            <Text style={styles.typeBadgeEmoji}>{type?.emoji}</Text>
            <Text style={[styles.typeBadgeLabel, { color: type?.color }]}>
              {type?.label}
            </Text>
          </View>
          <Text style={styles.momentMeta}>
            {item.user} · {item.time}
          </Text>
        </View>
        <Text style={styles.momentComment}>{item.comment}</Text>
        {item.clipUri && (
          <View style={styles.clipContainer}>
            <Image source={{ uri: item.clipUri }} style={styles.clipThumbnail} />
            {item.clipType === 'video' && (
              <View style={styles.clipPlayOverlay}>
                <Text style={styles.clipPlayIcon}>▶</Text>
              </View>
            )}
            <View style={styles.clipBadge}>
              <Text style={styles.clipBadgeText}>
                {item.clipType === 'video' ? '🎬 Video Clip' : '📸 Photo'}
              </Text>
            </View>
          </View>
        )}
        <View style={styles.reactionRow}>
          {item.reactions.map((r) => (
            <TouchableOpacity
              key={r.emoji}
              style={[
                styles.reactionChip,
                r.reacted && styles.reactionChipActive,
              ]}
              onPress={() => toggleReaction(item.id, r.emoji)}
            >
              <Text style={styles.reactionEmoji}>{r.emoji}</Text>
              <Text
                style={[
                  styles.reactionCount,
                  r.reacted && styles.reactionCountActive,
                ]}
              >
                {r.count}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.addReactionBtn}
            onPress={() =>
              setShowEmojiPicker(
                showEmojiPicker === item.id ? null : item.id,
              )
            }
          >
            <Text style={styles.addReactionText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addReactionBtn}
            onPress={async () => {
              const { shareMoment } = await import('@/lib/sharing');
              await shareMoment({ id: item.id, comment: item.comment, momentType: type?.label || 'Moment' });
            }}
          >
            <Share2 size={14} color={Colors.dark.textSecondary} />
          </TouchableOpacity>
          {item.user === 'You' && (
            <TouchableOpacity
              style={styles.addReactionBtn}
              onPress={() => handleDeleteMoment(item.id)}
            >
              <Trash2 size={14} color={Colors.dark.error} />
            </TouchableOpacity>
          )}
        </View>
        {showEmojiPicker === item.id && (
          <View style={styles.emojiPickerRow}>
            {REACTION_EMOJIS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={styles.emojiPickerItem}
                onPress={() => addReactionFromPicker(item.id, emoji)}
              >
                <Text style={styles.emojiPickerText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={moments}
        keyExtractor={(item) => item.id}
        renderItem={renderMomentCard}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <TouchableOpacity
            style={styles.postButton}
            onPress={() => setShowPostModal(true)}
          >
            <Text style={styles.postButtonText}>Post a Moment</Text>
          </TouchableOpacity>
        }
      />

      {/* Post Moment Modal */}
      <Modal
        visible={showPostModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPostModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.modalContent, { paddingBottom: insets.bottom + 20 }]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              <Text style={styles.modalTitle}>Post a Moment</Text>

              <Text style={styles.modalLabel}>Select Moment Type</Text>
              <View style={styles.typeGridContent}>
                {momentTypes.map((type) => (
                  <TouchableOpacity
                    key={type.id}
                    style={[
                      styles.typeOption,
                      selectedType?.id === type.id && {
                        borderColor: type.color,
                        backgroundColor: type.color + '22',
                      },
                    ]}
                    onPress={() => setSelectedType(type)}
                  >
                    <Text style={styles.typeOptionEmoji}>{type.emoji}</Text>
                    <Text style={styles.typeOptionLabel}>{type.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.modalLabel, { marginTop: 16 }]}>Attach a Clip</Text>
              {clipUri ? (
                <View style={styles.clipPreviewRow}>
                  <Image source={{ uri: clipUri }} style={styles.clipPreviewThumb} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.clipPreviewLabel}>
                      {clipType === 'video' ? '🎬 Video clip attached' : '📸 Photo attached'}
                    </Text>
                    <Text style={styles.clipPreviewHint}>Max 30 seconds</Text>
                  </View>
                  <TouchableOpacity onPress={() => { setClipUri(null); setClipType(null); }}>
                    <X size={20} color={Colors.dark.textMuted} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.clipButtonRow}>
                  <TouchableOpacity style={styles.clipButton} onPress={recordClip}>
                    <Video size={20} color={Colors.dark.accent} />
                    <Text style={styles.clipButtonText}>Record Clip</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.clipButton} onPress={pickClip}>
                    <Film size={20} color={Colors.dark.accent} />
                    <Text style={styles.clipButtonText}>From Gallery</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={[styles.modalLabel, { marginTop: 12 }]}>Comment</Text>
              <TextInput
                style={styles.commentInput}
                placeholder="What just happened?"
                placeholderTextColor={Colors.dark.textMuted}
                value={commentText}
                onChangeText={setCommentText}
                multiline
                maxLength={280}
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setShowPostModal(false);
                  setSelectedType(null);
                  setCommentText('');
                  setClipUri(null);
                  setClipType(null);
                }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  (!selectedType || !commentText.trim()) &&
                    styles.submitBtnDisabled,
                ]}
                onPress={handlePost}
                disabled={!selectedType || !commentText.trim()}
              >
                <Text style={styles.submitBtnText}>Post</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  listContent: {
    padding: 12,
    paddingBottom: 24,
  },
  postButton: {
    backgroundColor: Colors.dark.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  postButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  // Moment Card
  momentCard: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  momentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 4,
  },
  typeBadgeEmoji: {
    fontSize: 14,
  },
  typeBadgeLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  momentMeta: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  momentComment: {
    fontSize: 14,
    color: Colors.dark.text,
    lineHeight: 20,
    marginBottom: 10,
  },
  reactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    gap: 4,
  },
  reactionChipActive: {
    backgroundColor: Colors.dark.accent + '33',
    borderWidth: 1,
    borderColor: Colors.dark.accent,
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontWeight: '600',
  },
  reactionCountActive: {
    color: Colors.dark.accentLight,
  },
  addReactionBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.dark.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addReactionText: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    fontWeight: '600',
  },
  emojiPickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    padding: 8,
    backgroundColor: Colors.dark.surfaceLight,
    borderRadius: 10,
  },
  emojiPickerItem: {
    padding: 6,
  },
  emojiPickerText: {
    fontSize: 20,
  },
  // Clip in card
  clipContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 10,
    height: 180,
    backgroundColor: '#000',
  },
  clipThumbnail: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  clipPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  clipPlayIcon: {
    fontSize: 36,
    color: '#fff',
  },
  clipBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  clipBadgeText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  // Clip in modal
  clipButtonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  clipButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.dark.background,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
    borderStyle: 'dashed',
  },
  clipButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.accent,
  },
  clipPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    backgroundColor: Colors.dark.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
    marginBottom: 8,
  },
  clipPreviewThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#000',
  },
  clipPreviewLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.text,
  },
  clipPreviewHint: {
    fontSize: 11,
    color: Colors.dark.textMuted,
    marginTop: 2,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.dark.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    maxHeight: '90%',
  },
  modalScrollContent: {
    paddingBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
    marginBottom: 8,
  },
  typeGridContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.dark.surfaceLight,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  typeOptionEmoji: {
    fontSize: 16,
  },
  typeOptionLabel: {
    fontSize: 13,
    color: Colors.dark.text,
    fontWeight: '600',
  },
  commentInput: {
    backgroundColor: Colors.dark.background,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: Colors.dark.text,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: Colors.dark.border,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.dark.surfaceLight,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  submitBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.dark.accent,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
