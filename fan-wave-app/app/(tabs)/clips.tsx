import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Animated,
  ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Heart, MessageCircle, Repeat2, Share2, UserPlus, Download, Plus, Trash2, Slash } from 'lucide-react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/Colors';
import { SportPillRow } from '@/components/SportPill';
import { supabase } from '@/lib/supabase';
import { subscribeToClips } from '@/lib/realtime';
import { mapClipToDisplay, type ClipDisplay } from '@/lib/mappers';
import {
  subscribeToClipUploads,
  retryClipUpload,
  cancelClipUpload,
  type JobState,
} from '@/lib/clipUploads';
import { trackEvent } from '@/lib/analytics';
import { blockUser } from '@/lib/blocks';
import { ClipShareSheet } from '@/components/ClipShareSheet';

const PAGE_SIZE = 20;

const FILTER_PILLS = [
  { id: 'foryou', label: 'For You' },
  { id: 'following', label: 'Following' },
  { id: 'trending', label: 'Trending' },
  { id: 'nfl', label: '🏈 NFL' },
  { id: 'nba', label: '🏀 NBA' },
];

function ClipCard({
  clip,
  isLiked,
  onLike,
  onShare,
  onComment,
  onFollow,
  onExport,
  onDelete,
  onBlock,
  isVisible,
  isFollowingPoster,
  isOwner,
}: {
  clip: ClipDisplay;
  isLiked: boolean;
  onLike: (clipId: string) => void;
  onShare: (clip: ClipDisplay) => void;
  onComment: () => void;
  onFollow: (userId: string) => void;
  onExport: (clip: ClipDisplay) => void;
  onDelete: (clip: ClipDisplay) => void;
  onBlock: (clip: ClipDisplay) => void;
  isVisible: boolean;
  isFollowingPoster: boolean;
  isOwner: boolean;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  // Tracks expo-video player readiness so we can hide the raw VideoView
  // (which paints solid black before the first frame is decoded) and show a
  // loading placeholder instead. Without this, freshly-posted clips paint a
  // black void on first viewport entry until the user taps.
  const [isReady, setIsReady] = useState(false);
  const lastTapRef = useRef<number>(0);
  const heartAnimOpacity = useRef(new Animated.Value(0)).current;
  const heartAnimScale = useRef(new Animated.Value(0.5)).current;

  // CRITICAL: source MUST be stable for the lifetime of this card.
  // Previously we passed `isVisible ? clip.videoUrl : null` which forced
  // expo-video to tear down and recreate the underlying Android
  // MediaPlayer / MediaCodec on every visibility flip. During a fast
  // scroll the OS could not release codec slots fast enough, producing
  // an uncatchable SIGABRT in libmedia (the JS try/catch around
  // player.play() cannot intercept a native crash). We now create the
  // player once per card and only pause/play it.
  const player = useVideoPlayer(clip.videoUrl, (p) => {
    p.loop = true;
    // Feed-style mute-by-default. Users can unmute via the play overlay
    // (or future per-card mute toggle). Muted autoplay is also required
    // by iOS to start playback without a user gesture.
    p.muted = true;
  });

  // Subscribe to player status so we can render a placeholder while the
  // source is loading. expo-video status values: 'idle' | 'loading' |
  // 'readyToPlay' | 'error'. We treat 'readyToPlay' as the cue to swap
  // the placeholder for the live VideoView.
  //
  // The `mounted` flag guards against the player being GC'd between the
  // native callback firing and React scheduling the state update — which
  // is how the previous version could call setIsReady on an unmounted
  // card mid-scroll.
  useEffect(() => {
    if (!player) return;
    let mounted = true;
    setIsReady(false);
    const sub = player.addListener('statusChange', ({ status }) => {
      if (!mounted) return;
      setIsReady(status === 'readyToPlay');
    });
    return () => {
      mounted = false;
      try {
        sub.remove();
      } catch {
        /* listener may already be detached if the player was released */
      }
    };
  }, [player]);

  // Autoplay-on-visible (feed pattern). Pauses + rewinds when scrolled
  // off-screen so the next card paints its first frame, not the previous
  // card's last frame. Because the player itself never changes, this is
  // just a pause/play toggle — no MediaPlayer churn.
  useEffect(() => {
    if (!player) return;
    if (isVisible && isReady) {
      try {
        player.play();
        setIsPlaying(true);
      } catch {
        /* player can be torn down mid-render; safe to ignore */
      }
    } else if (!isVisible) {
      try {
        player.pause();
      } catch {
        /* ignore */
      }
      setIsPlaying(false);
    }
  }, [isVisible, isReady, player]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, player]);

  const showHeartAnimation = useCallback(() => {
    heartAnimOpacity.setValue(1);
    heartAnimScale.setValue(0.5);
    Animated.parallel([
      Animated.spring(heartAnimScale, {
        toValue: 1,
        friction: 3,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(600),
        Animated.timing(heartAnimOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [heartAnimOpacity, heartAnimScale]);

  const handleMediaPress = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (!isLiked) {
        onLike(clip.id);
      }
      showHeartAnimation();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
      setTimeout(() => {
        if (lastTapRef.current !== 0 && Date.now() - lastTapRef.current >= 280) {
          togglePlay();
        }
      }, 310);
    }
  }, [isLiked, onLike, clip.id, showHeartAnimation, togglePlay]);

  const displayLikes = clip.like_count ?? clip.likes;
  const displayComments = clip.comment_count ?? clip.comments;
  const displayViews = clip.view_count ?? 0;

  return (
    <View style={styles.clipCard}>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handleMediaPress}
        style={[styles.clipMedia, { backgroundColor: clip.bgColors[0] }]}
      >
        <VideoView
          player={player}
          style={styles.video}
          // nativeControls disabled — they overlap the caption/metadata
          // bar (causing the visual "previous clip's caption bleeds into
          // next clip's video" artifact) and conflict with the
          // double-tap-to-like gesture. We render our own play overlay.
          nativeControls={false}
          contentFit="cover"
        />
        {/* Loading placeholder — masks the solid-black first paint that
            expo-video shows before the source is decoded. Removed once
            the player reports 'readyToPlay'. */}
        {!isReady && (
          <View style={[styles.videoLoadingOverlay, { backgroundColor: clip.bgColors[0] }]}>
            <ActivityIndicator size="small" color="#fff" />
          </View>
        )}
        {isReady && !isPlaying && (
          <View style={styles.playOverlay}>
            <Text style={styles.playIcon}>▶</Text>
          </View>
        )}

        {displayViews > 0 && (
          <View style={styles.viewCountBadge}>
            <Text style={styles.viewCountText}>👁 {displayViews.toLocaleString()}</Text>
          </View>
        )}

        <Animated.View
          pointerEvents="none"
          style={[
            styles.doubleTapHeart,
            {
              opacity: heartAnimOpacity,
              transform: [{ scale: heartAnimScale }],
            },
          ]}
        >
          <Text style={styles.doubleTapHeartEmoji}>❤️</Text>
        </Animated.View>
      </TouchableOpacity>

      <View style={styles.clipInfo}>
        <Text style={styles.clipTitle}>{clip.title}</Text>
        <View style={styles.clipMetaRow}>
          <Text style={styles.clipMeta}>
            {clip.poster} · {clip.group} · {clip.time}
          </Text>
          {clip.userId && !isFollowingPoster && !isOwner && (
            <TouchableOpacity style={styles.followChip} onPress={() => onFollow(clip.userId)}>
              <UserPlus size={12} color={Colors.dark.accent} />
              <Text style={styles.followChipText}>Follow</Text>
            </TouchableOpacity>
          )}
          {!isOwner && clip.userId && (
            <TouchableOpacity
              style={styles.blockChip}
              onPress={() => onBlock(clip)}
              accessibilityLabel="Block this user"
            >
              <Slash size={12} color={Colors.dark.error} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.clipActions}>
          <TouchableOpacity style={styles.actionItem} onPress={() => onLike(clip.id)}>
            <Heart
              size={16}
              color={isLiked ? Colors.dark.error : Colors.dark.textSecondary}
              fill={isLiked ? Colors.dark.error : 'none'}
            />
            <Text style={[styles.actionText, isLiked && styles.likedText]}>
              {displayLikes}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionItem} onPress={onComment}>
            <MessageCircle size={16} color={Colors.dark.textSecondary} />
            <Text style={styles.actionText}>{displayComments}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionItem}>
            <Repeat2 size={16} color={Colors.dark.textSecondary} />
            <Text style={styles.actionText}>{clip.shares}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionItem} onPress={() => onShare(clip)}>
            <Share2 size={16} color={Colors.dark.textSecondary} />
            <Text style={styles.actionText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionItem} onPress={() => onExport(clip)}>
            <Download size={16} color={Colors.dark.textSecondary} />
            <Text style={styles.actionText}>Save</Text>
          </TouchableOpacity>
          {isOwner && (
            <TouchableOpacity style={styles.actionItem} onPress={() => onDelete(clip)}>
              <Trash2 size={16} color={Colors.dark.error} />
              <Text style={[styles.actionText, { color: Colors.dark.error }]}>Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

export default function ClipsScreen() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState('foryou');
  const [clips, setClips] = useState<ClipDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);
  const [likedClipIds, setLikedClipIds] = useState<Set<string>>(new Set());
  const [visibleClipIds, setVisibleClipIds] = useState<Set<string>>(new Set());
  // Custom share sheet (v8.3): TikTok / IG Stories / Copy Link / More apps.
  // The sheet wraps the legacy expo-sharing system-share path as its
  // "More apps..." row, so existing behavior remains as a fallback.
  const [shareTarget, setShareTarget] = useState<ClipDisplay | null>(null);

  const fetchClips = useCallback(
    async (pageNum: number, filter: string, replace: boolean = false) => {
      try {
        let query = supabase
          .from('media_clips')
          .select('*')
          .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1)
          .limit(PAGE_SIZE);

        if (filter === 'trending') {
          query = query.order('like_count', { ascending: false });
        } else if (filter === 'following') {
          query = query.order('created_at', { ascending: false });
        } else if (['nfl', 'nba'].includes(filter)) {
          query = query.eq('sport', filter).order('created_at', { ascending: false });
        } else {
          query = query.order('like_count', { ascending: false });
        }

        const { data, error } = await query;

        if (error) throw error;

        if (data && data.length > 0) {
          const mapped = data.map(mapClipToDisplay);

          if (replace) {
            setClips(mapped);
          } else {
            setClips((prev) => [...prev, ...mapped]);
          }
          setHasMore(data.length === PAGE_SIZE);
        } else {
          if (replace) setClips([]);
          setHasMore(false);
        }
      } catch {
        if (replace) setClips([]);
        setHasMore(false);
      }
    },
    []
  );

  // Initial load
  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchClips(0, activeFilter, true);
      setLoading(false);
    })();
  }, [activeFilter, fetchClips]);

  // Realtime subscription for new clips — only active when tab is focused.
  // Deduplicates against optimistic placeholders: if a row arrives via
  // postgres_changes whose media_url matches a queue job we already have
  // in the cache, skip — the success handler below will swap the placeholder
  // for the real row.
  useFocusEffect(
    useCallback(() => {
      const unsub = subscribeToClips(
        (newClip) => {
          setClips((prev) => {
            if (prev.some((c) => c.id === newClip.id)) return prev;
            if (
              prev.some(
                (c) =>
                  c.status === 'uploading' &&
                  !!c.pendingMediaUrl &&
                  c.pendingMediaUrl === newClip.media_url,
              )
            ) {
              return prev;
            }
            return [mapClipToDisplay(newClip), ...prev].slice(0, 200);
          });
        },
        (updatedClip) => {
          setClips((prev) =>
            prev.map((c) => (c.id === updatedClip.id ? mapClipToDisplay(updatedClip) : c))
          );
        },
      );
      return unsub;
    }, [])
  );

  // Bridge the upload queue into the feed so the clip appears the instant
  // the user taps Post. Lifecycle: queued → uploading → inserting → live
  // (real row swap) or failed. Listener is mounted once per screen
  // instance; subscribeToClipUploads replays current state on subscribe.
  useEffect(() => {
    const unsub = subscribeToClipUploads((state: JobState) => {
      setClips((prev) => {
        // Cancellation: emit may come through with undefined status to
        // signal placeholder removal.
        if (!state.status) {
          return prev.filter((c) => c.tempId !== state.tempId);
        }
        const idx = prev.findIndex((c) => c.tempId === state.tempId);

        // Success path: real row swap.
        if (state.realId && state.mediaUrl) {
          const live: ClipDisplay = {
            id: state.realId,
            title: state.title,
            poster: `@${state.displayName}`,
            group: 'Fan Sphere',
            time: 'Just now',
            sport: state.sportId,
            sportIcon: '',
            likes: 0, like_count: 0, view_count: 0,
            comments: 0, comment_count: 0, shares: 0,
            bgColors: ['#1a3a5c', '#2a4a7c'],
            videoUrl: state.mediaUrl,
            userId: state.userId,
            mediaType: 'video',
            status: 'live',
          };
          if (idx === -1) return [live, ...prev].slice(0, 200);
          const copy = prev.slice();
          copy[idx] = live;
          return copy;
        }

        // Optimistic / in-progress / failed.
        const placeholder: ClipDisplay = {
          id: state.tempId,
          tempId: state.tempId,
          localUri: state.localUri,
          pendingMediaUrl: state.mediaUrl,
          title: state.title,
          poster: `@${state.displayName}`,
          group: 'Fan Sphere',
          time: 'Posting…',
          sport: state.sportId,
          sportIcon: '',
          likes: 0, like_count: 0, view_count: 0,
          comments: 0, comment_count: 0, shares: 0,
          bgColors: ['#1a3a5c', '#2a4a7c'],
          videoUrl: '',
          userId: state.userId,
          mediaType: 'video',
          status: state.status === 'failed' ? 'failed' : 'uploading',
          progress: state.progress,
        };
        if (idx === -1) return [placeholder, ...prev].slice(0, 200);
        const copy = prev.slice();
        copy[idx] = placeholder;
        return copy;
      });
    });
    return unsub;
  }, []);

  const handleRetryUpload = useCallback((tempId: string) => retryClipUpload(tempId), []);
  const handleCancelUpload = useCallback((tempId: string) => cancelClipUpload(tempId), []);

  const handleFilterChange = useCallback(
    (filterId: string) => {
      if (filterId === activeFilter) return;
      setActiveFilter(filterId);
      setPage(0);
      setHasMore(true);
    },
    [activeFilter]
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setPage(0);
    setHasMore(true);
    await fetchClips(0, activeFilter, true);
    setRefreshing(false);
  }, [activeFilter, fetchClips]);

  const handleEndReached = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    setPage(nextPage);
    await fetchClips(nextPage, activeFilter, false);
    setLoadingMore(false);
  }, [loadingMore, hasMore, page, activeFilter, fetchClips]);

  // Like toggle with optimistic UI
  const handleLike = useCallback(
    async (clipId: string) => {
      const wasLiked = likedClipIds.has(clipId);
      const delta = wasLiked ? -1 : 1;

      setLikedClipIds((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.delete(clipId);
        else next.add(clipId);
        return next;
      });

      setClips((prev) =>
        prev.map((c) =>
          c.id === clipId
            ? { ...c, likes: c.likes + delta, like_count: (c.like_count ?? c.likes) + delta }
            : c
        )
      );

      if (!wasLiked) {
        trackEvent('clip_liked', 'clips', { clip_id: clipId });
      }

      try {
        await supabase.rpc('toggle_clip_like', { p_clip_id: clipId });
      } catch {
        // Rollback
        setLikedClipIds((prev) => {
          const next = new Set(prev);
          if (wasLiked) next.add(clipId);
          else next.delete(clipId);
          return next;
        });
        setClips((prev) =>
          prev.map((c) =>
            c.id === clipId
              ? { ...c, likes: c.likes - delta, like_count: (c.like_count ?? c.likes) - delta }
              : c
          )
        );
      }
    },
    [likedClipIds]
  );

  const [followedUserIds, setFollowedUserIds] = useState<Set<string>>(new Set());

  const handleFollow = useCallback(async (userId: string) => {
    if (!userId || followedUserIds.has(userId)) return;
    setFollowedUserIds((prev) => new Set(prev).add(userId));
    const { followUser } = await import('@/lib/userFollows');
    const success = await followUser(userId);
    if (!success) {
      setFollowedUserIds((prev) => { const next = new Set(prev); next.delete(userId); return next; });
    }
  }, [followedUserIds]);

  const handleExport = useCallback(async (clip: ClipDisplay) => {
    const { exportClipToGallery } = await import('@/lib/clipExport');
    await exportClipToGallery({
      id: clip.id,
      title: clip.title,
      mediaUrl: clip.videoUrl,
      mediaType: clip.mediaType,
    });
  }, []);

  const handleShare = useCallback((clip: ClipDisplay) => {
    // Replaces the previous direct expo-sharing call with the custom
    // ClipShareSheet so users get an explicit "Share to TikTok" row in
    // addition to the original system share sheet (now "More apps...").
    setShareTarget(clip);
  }, []);

  const handleDelete = useCallback((clip: ClipDisplay) => {
    Alert.alert(
      'Delete Clip',
      `Delete "${clip.title}"? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Optimistic remove — RLS `media_clips_delete` scopes to auth.uid,
            // so the DB will reject if somehow not the owner.
            setClips((prev) => prev.filter((c) => c.id !== clip.id));
            const { error } = await supabase
              .from('media_clips')
              .delete()
              .eq('id', clip.id);
            if (error) {
              Alert.alert('Could not delete', error.message);
            }
          },
        },
      ],
    );
  }, []);

  const handleComment = useCallback(() => {
    // Comments will be enabled in a future release
  }, []);

  const handleBlock = useCallback((clip: ClipDisplay) => {
    if (!clip.userId) return;
    Alert.alert(
      'Block user',
      `Block ${clip.poster}? You won't see their clips, watch parties, or messages, and they won't see yours. You can unblock from Profile → Blocked Users.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            const ok = await blockUser(clip.userId);
            if (ok) {
              setClips((prev) => prev.filter((c) => c.userId !== clip.userId));
            } else {
              Alert.alert('Could not block', 'Please try again.');
            }
          },
        },
      ],
    );
  }, []);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const ids = new Set(viewableItems.map((item) => item.item?.id).filter(Boolean));
      setVisibleClipIds(ids);
    }
  ).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const renderClipItem = useCallback(
    ({ item }: { item: ClipDisplay }) => (
      <ClipCard
        clip={item}
        isLiked={likedClipIds.has(item.id)}
        onLike={handleLike}
        onShare={handleShare}
        onComment={handleComment}
        onFollow={handleFollow}
        onExport={handleExport}
        onDelete={handleDelete}
        onBlock={handleBlock}
        isVisible={visibleClipIds.has(item.id)}
        isFollowingPoster={followedUserIds.has(item.userId)}
        isOwner={!!currentUserId && item.userId === currentUserId}
      />
    ),
    [likedClipIds, handleLike, handleShare, handleComment, visibleClipIds, handleDelete, handleBlock, currentUserId, handleExport, handleFollow, followedUserIds]
  );

  const renderFooter = useCallback(() => {
    if (!loadingMore) return <View style={styles.spacer} />;
    return (
      <View style={styles.loadingFooter}>
        <ActivityIndicator size="small" color={Colors.dark.accent} />
      </View>
    );
  }, [loadingMore]);

  const renderEmpty = useCallback(() => {
    if (loading) return null;
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyEmoji}>🎬</Text>
        <Text style={styles.emptyTitle}>No highlights yet — drop the first one!</Text>
        <Text style={styles.emptySubtext}>Be the first to share a highlight!</Text>
      </View>
    );
  }, [loading]);

  const handleUploadPress = useCallback(() => {
    Alert.alert(
      'New Clip',
      'Add a highlight to the feed.',
      [
        {
          text: 'Record new',
          onPress: async () => {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert(
                'Camera permission denied',
                'Enable camera access in Settings to record clips.'
              );
              return;
            }
            const result = await ImagePicker.launchCameraAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Videos,
              videoMaxDuration: 30,
              quality: 0.8,
            });
            if (!result.canceled && result.assets[0]?.uri) {
              const asset = result.assets[0];
              router.push({
                pathname: '/create-clip',
                params: {
                  videoUri: asset.uri,
                  durationMs: String(asset.duration ?? ''),
                },
              });
            }
          },
        },
        {
          text: 'Choose from library',
          onPress: async () => {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert(
                'Library permission denied',
                'Enable photo library access in Settings to pick a clip.'
              );
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Videos,
              quality: 0.8,
            });
            if (!result.canceled && result.assets[0]?.uri) {
              const asset = result.assets[0];
              router.push({
                pathname: '/create-clip',
                params: {
                  videoUri: asset.uri,
                  durationMs: String(asset.duration ?? ''),
                },
              });
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, [router]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Clips</Text>
        <Text style={styles.subtitle}>Latest highlights from your communities</Text>
      </View>

      <View style={styles.pillContainer}>
        <SportPillRow
          pills={FILTER_PILLS}
          activeId={activeFilter}
          onSelect={handleFilterChange}
        />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.dark.accent} />
        </View>
      ) : (
        <FlatList
          data={clips}
          keyExtractor={(item) => item.id}
          renderItem={renderClipItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={renderEmpty}
          // Virtualization — caps the number of expo-video MediaPlayers
          // alive at once. windowSize=3 keeps roughly the current page +/-1
          // mounted; maxToRenderPerBatch=2 throttles how many new
          // ClipCards spin up per scroll tick; removeClippedSubviews lets
          // Android unmount fully off-screen views (freeing MediaCodec
          // slots) instead of just hiding them. Without these caps, a
          // fast scroll-up on Android exhausts the 8-slot global codec
          // pool and force-closes the app.
          windowSize={3}
          maxToRenderPerBatch={2}
          initialNumToRender={2}
          removeClippedSubviews={true}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.dark.accent}
              colors={[Colors.dark.accent]}
            />
          }
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
        />
      )}

      <TouchableOpacity
        style={styles.uploadFab}
        onPress={handleUploadPress}
        accessibilityLabel="Post a new clip"
      >
        <Plus size={28} color="#fff" />
      </TouchableOpacity>

      {shareTarget && (
        <ClipShareSheet
          visible={!!shareTarget}
          onClose={() => setShareTarget(null)}
          clip={{
            id: shareTarget.id,
            title: shareTarget.title,
            mediaUrl: shareTarget.videoUrl,
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.dark.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginTop: 4,
  },
  pillContainer: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  uploadFab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.dark.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 6,
  },
  listContent: {
    paddingHorizontal: 16,
  },
  clipCard: {
    backgroundColor: Colors.dark.surface,
    borderRadius: 16,
    // overflow:hidden is critical — without it the absolutely-positioned
    // video overlays (play button, view count badge, double-tap heart)
    // can paint outside the card bounds and bleed into the next card.
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  clipMedia: {
    width: '100%',
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
    // Belt-and-braces: clip the video region itself so the VideoView and
    // its native control surfaces cannot overflow into the clipInfo
    // section below (the root cause of the caption-overlap artifact).
    overflow: 'hidden',
    position: 'relative',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  videoLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playOverlay: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(108,92,231,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    fontSize: 22,
    color: '#fff',
    marginLeft: 4,
  },
  viewCountBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  viewCountText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '600',
  },
  doubleTapHeart: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doubleTapHeartEmoji: {
    fontSize: 72,
  },
  clipInfo: {
    padding: 14,
  },
  clipTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  clipMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  clipMeta: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    flex: 1,
  },
  followChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
  },
  followChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.dark.accent,
  },
  blockChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.error,
    marginLeft: 6,
  },
  clipActions: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 10,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
  likedText: {
    color: '#e74c3c',
  },
  spacer: {
    height: 20,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingFooter: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginTop: 4,
  },
});
