import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  Alert,
  Dimensions,
} from 'react-native';
import { X, Play, Heart, MessageCircle } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';

interface Highlight {
  id: string;
  title: string;
  description: string;
  duration: string;
  type: 'video' | 'image';
  thumbnailColor: string;
  views: number;
  likes: number;
  liked: boolean;
  commentCount: number;
  user: string;
}

interface HighlightsGridProps {
  chatRoomId: string;
}


const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_GAP = 10;
const CARD_WIDTH = (SCREEN_WIDTH - 12 * 2 - CARD_GAP) / 2;

export default function HighlightsGrid({ chatRoomId }: HighlightsGridProps) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [selectedHighlight, setSelectedHighlight] = useState<Highlight | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');

  const formatCount = (n: number): string => {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toString();
  };

  const toggleLike = (highlightId: string) => {
    setHighlights((prev) =>
      prev.map((h) =>
        h.id === highlightId
          ? {
              ...h,
              liked: !h.liked,
              likes: h.liked ? h.likes - 1 : h.likes + 1,
            }
          : h,
      ),
    );
    if (selectedHighlight?.id === highlightId) {
      setSelectedHighlight((prev) =>
        prev
          ? {
              ...prev,
              liked: !prev.liked,
              likes: prev.liked ? prev.likes - 1 : prev.likes + 1,
            }
          : null,
      );
    }
  };

  const handleUpload = async () => {
    if (!uploadTitle.trim()) return;

    // Camera roll access — placeholder until media upload is complete
    const newHighlight: Highlight = {
      id: `h-${Date.now()}`,
      title: uploadTitle.trim(),
      description: uploadDescription.trim(),
      duration: '0:30',
      type: 'video',
      thumbnailColor: '#6c5ce7',
      views: 0,
      likes: 0,
      liked: false,
      commentCount: 0,
      user: 'You',
    };

    setHighlights((prev) => [newHighlight, ...prev]);
    setShowUploadModal(false);
    setUploadTitle('');
    setUploadDescription('');

    try {
      await supabase.from('highlights').insert({
        chat_room_id: chatRoomId,
        title: newHighlight.title,
        description: newHighlight.description,
        type: 'video',
        user_name: 'You',
      });
    } catch {
      // Graceful fallback — highlight already added locally
    }
  };

  const renderThumbnailCard = ({ item }: { item: Highlight }) => (
    <TouchableOpacity
      style={styles.thumbnailCard}
      onPress={() => setSelectedHighlight(item)}
      activeOpacity={0.8}
    >
      <View style={[styles.thumbnail, { backgroundColor: item.thumbnailColor + '44' }]}>
        {item.type === 'video' && (
          <View style={styles.playOverlay}>
            <Play size={28} color="#fff" fill="#fff" />
          </View>
        )}
        {item.duration ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{item.duration}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.thumbnailTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <View style={styles.thumbnailStats}>
        <Text style={styles.statText}>{formatCount(item.views)} views</Text>
        <Text style={styles.statDot}>·</Text>
        <Text style={styles.statText}>{formatCount(item.likes)} likes</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={highlights}
        keyExtractor={(item) => item.id}
        renderItem={renderThumbnailCard}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <TouchableOpacity
            style={styles.postButton}
            onPress={() => setShowUploadModal(true)}
          >
            <Text style={styles.postButtonText}>Post a Highlight</Text>
          </TouchableOpacity>
        }
      />

      {/* Full-Screen Viewer Modal */}
      <Modal
        visible={!!selectedHighlight}
        animationType="fade"
        transparent
        onRequestClose={() => setSelectedHighlight(null)}
      >
        <View style={styles.viewerOverlay}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => setSelectedHighlight(null)}
          >
            <X size={24} color="#fff" />
          </TouchableOpacity>

          {selectedHighlight && (
            <View style={styles.viewerContent}>
              <Text style={styles.viewerTitle}>{selectedHighlight.title}</Text>
              <View
                style={[
                  styles.viewerPlaceholder,
                  { backgroundColor: selectedHighlight.thumbnailColor + '44' },
                ]}
              >
                {selectedHighlight.type === 'video' ? (
                  <View style={styles.viewerPlayIcon}>
                    <Play size={48} color="#fff" fill="#fff" />
                  </View>
                ) : (
                  <Text style={styles.viewerPlaceholderText}>Image</Text>
                )}
              </View>
              {selectedHighlight.description ? (
                <Text style={styles.viewerDescription}>
                  {selectedHighlight.description}
                </Text>
              ) : null}
              <View style={styles.viewerActions}>
                <TouchableOpacity
                  style={styles.viewerAction}
                  onPress={() => toggleLike(selectedHighlight.id)}
                >
                  <Heart
                    size={22}
                    color={selectedHighlight.liked ? '#ff4444' : '#fff'}
                    fill={selectedHighlight.liked ? '#ff4444' : 'transparent'}
                  />
                  <Text style={styles.viewerActionText}>
                    {selectedHighlight.likes}
                  </Text>
                </TouchableOpacity>
                <View style={styles.viewerAction}>
                  <MessageCircle size={22} color="#fff" />
                  <Text style={styles.viewerActionText}>
                    {selectedHighlight.commentCount}
                  </Text>
                </View>
              </View>
              <Text style={styles.viewerMeta}>
                Posted by {selectedHighlight.user} · {formatCount(selectedHighlight.views)} views
              </Text>
            </View>
          )}
        </View>
      </Modal>

      {/* Upload Modal */}
      <Modal
        visible={showUploadModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowUploadModal(false)}
      >
        <View style={styles.uploadOverlay}>
          <View style={styles.uploadContent}>
            <Text style={styles.uploadTitle}>Post a Highlight</Text>

            <Text style={styles.uploadLabel}>Title</Text>
            <TextInput
              style={styles.uploadInput}
              placeholder="Give your clip a title"
              placeholderTextColor={Colors.dark.textMuted}
              value={uploadTitle}
              onChangeText={setUploadTitle}
              maxLength={100}
            />

            <Text style={styles.uploadLabel}>Description (optional)</Text>
            <TextInput
              style={[styles.uploadInput, styles.uploadInputMultiline]}
              placeholder="Add context..."
              placeholderTextColor={Colors.dark.textMuted}
              value={uploadDescription}
              onChangeText={setUploadDescription}
              multiline
              maxLength={280}
            />

            <View style={styles.uploadActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setShowUploadModal(false);
                  setUploadTitle('');
                  setUploadDescription('');
                }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  !uploadTitle.trim() && styles.submitBtnDisabled,
                ]}
                onPress={handleUpload}
                disabled={!uploadTitle.trim()}
              >
                <Text style={styles.submitBtnText}>Upload</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
  gridRow: {
    justifyContent: 'space-between',
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
  // Thumbnail Card
  thumbnailCard: {
    width: CARD_WIDTH,
    marginBottom: 14,
  },
  thumbnail: {
    width: '100%',
    height: CARD_WIDTH * 0.75,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  playOverlay: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  thumbnailTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.text,
    marginTop: 6,
  },
  thumbnailStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  statText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  statDot: {
    fontSize: 11,
    color: Colors.dark.textMuted,
  },
  // Full-screen viewer
  viewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  closeBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  viewerContent: {
    width: '100%',
    alignItems: 'center',
  },
  viewerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
    textAlign: 'center',
  },
  viewerPlaceholder: {
    width: '100%',
    height: 220,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  viewerPlayIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerPlaceholderText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  viewerDescription: {
    fontSize: 14,
    color: '#ccc',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
    paddingHorizontal: 12,
  },
  viewerActions: {
    flexDirection: 'row',
    gap: 28,
    marginBottom: 12,
  },
  viewerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  viewerActionText: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '600',
  },
  viewerMeta: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    marginTop: 4,
  },
  // Upload modal
  uploadOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  uploadContent: {
    backgroundColor: Colors.dark.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  uploadTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  uploadLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
    marginBottom: 8,
  },
  uploadInput: {
    backgroundColor: Colors.dark.background,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    color: Colors.dark.text,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    marginBottom: 16,
  },
  uploadInputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  uploadActions: {
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
