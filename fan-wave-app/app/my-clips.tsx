import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Play, X, Eye, Heart, MessageCircle, Share2, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';

const { width } = Dimensions.get('window');
const COLUMN_GAP = 12;
const CARD_WIDTH = (width - 16 * 2 - COLUMN_GAP) / 2;

interface Clip {
  id: string;
  title: string;
  description: string;
  duration: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  color: string;
  created_at: string;
}

export default function MyClipsScreen() {
  const router = useRouter();
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);

  useEffect(() => {
    loadClips();
  }, []);

  const loadClips = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data, error } = await supabase
          .from('media_clips')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (data && !error && data.length > 0) {
          setClips(data);
          setLoading(false);
          return;
        }
      }
    } catch {
      // Error loading clips
    }
    setClips([]);
    setLoading(false);
  };

  const handleDelete = (clip: Clip) => {
    Alert.alert(
      'Delete Clip',
      `Are you sure you want to delete "${clip.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('media_clips')
                .delete()
                .eq('id', clip.id);

              if (error) throw error;
            } catch {
              // local fallback
            }
            setClips((prev) => prev.filter((c) => c.id !== clip.id));
            setSelectedClip(null);
          },
        },
      ],
    );
  };

  const formatCount = (n: number | null | undefined) => {
    if (!n) return '0';
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toString();
  };

  const renderClip = ({ item }: { item: Clip }) => (
    <TouchableOpacity
      style={styles.clipCard}
      onPress={() => setSelectedClip(item)}
      activeOpacity={0.8}
    >
      <View style={[styles.clipThumb, { backgroundColor: item.color }]}>
        <Play size={28} color="#fff" fill="#fff" />
        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>{item.duration}</Text>
        </View>
      </View>
      <Text style={styles.clipTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <View style={styles.clipMeta}>
        <View style={styles.metaItem}>
          <Eye size={12} color={Colors.dark.textSecondary} />
          <Text style={styles.metaText}>{formatCount(item.views)}</Text>
        </View>
        <View style={styles.metaItem}>
          <Heart size={12} color={Colors.dark.textSecondary} />
          <Text style={styles.metaText}>{formatCount(item.likes)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={24} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Clips</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      ) : clips.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Your highlights reel is empty — capture the moment!</Text>
        </View>
      ) : (
        <FlatList
          data={clips}
          renderItem={renderClip}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Full-screen viewer modal */}
      <Modal
        visible={!!selectedClip}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setSelectedClip(null)}
      >
        <SafeAreaView style={styles.modalContainer}>
          {selectedClip && (
            <>
              {/* Close button */}
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setSelectedClip(null)}
              >
                <X size={24} color={Colors.dark.text} />
              </TouchableOpacity>

              {/* Clip preview area */}
              <View style={[styles.modalPreview, { backgroundColor: selectedClip.color }]}>
                <Play size={48} color="#fff" fill="#fff" />
              </View>

              {/* Info */}
              <View style={styles.modalInfo}>
                <Text style={styles.modalTitle}>{selectedClip.title}</Text>
                <Text style={styles.modalDescription}>{selectedClip.description}</Text>

                {/* Stats row */}
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Eye size={16} color={Colors.dark.textSecondary} />
                    <Text style={styles.statText}>{formatCount(selectedClip.views)}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Heart size={16} color={Colors.dark.textSecondary} />
                    <Text style={styles.statText}>{formatCount(selectedClip.likes)}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <MessageCircle size={16} color={Colors.dark.textSecondary} />
                    <Text style={styles.statText}>{formatCount(selectedClip.comments)}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Share2 size={16} color={Colors.dark.textSecondary} />
                    <Text style={styles.statText}>{formatCount(selectedClip.shares)}</Text>
                  </View>
                </View>

                {/* Delete button */}
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDelete(selectedClip)}
                >
                  <Trash2 size={18} color="#fff" />
                  <Text style={styles.deleteBtnText}>Delete Clip</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.surface,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
  },
  grid: {
    padding: 16,
  },
  row: {
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  clipCard: {
    width: CARD_WIDTH,
  },
  clipThumb: {
    width: '100%',
    aspectRatio: 9 / 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  clipTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.text,
    marginTop: 8,
  },
  clipMeta: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  closeBtn: {
    position: 'absolute',
    top: 56,
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.dark.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPreview: {
    width: '100%',
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
  },
  modalInfo: {
    padding: 20,
    flex: 1,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    lineHeight: 20,
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.surface,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    fontWeight: '600',
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    backgroundColor: Colors.dark.error,
    paddingVertical: 14,
    borderRadius: 12,
  },
  deleteBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
