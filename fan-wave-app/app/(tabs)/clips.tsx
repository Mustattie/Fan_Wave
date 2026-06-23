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
import { Heart, MessageCircle, Repeat2, Share2, UserPlus, Download, Plus, Trash2, Slash, Pause, Play } from 'lucide-react-native';
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
  isActive,
  isFollowingPoster,
  isOwner,
  sharedPlayer,
  isPlaying,
  isReady,
  onTogglePlay,
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
  // v8.6 P0: was `isVisible`. Now strictly the SINGLE active card. Only
  // the active card mounts <VideoView> attached to the shared player —
  // see ClipsScreen for the architectural rewrite.
  isActive: boolean;
  isFollowingPoster: boolean;
  isOwner: boolean;
  // The ONE expo-video player instance owned by ClipsScreen. Inactive
  // cards do not receive it (only the active one renders VideoView).
  sharedPlayer: ReturnType<typeof useVideoPlayer> | null;
  isPlaying: boolean;
  isReady: boolean;
  onTogglePlay: () => void;
}) {
  const lastTapRef = useRef<number>(0);
  const heartAnimOpacity = useRef(new Animated.Value(0)).current;
  const heartAnimScale = useRef(new Animated.Value(0.5)).current;

  // v8.6 P0 ROOT CAUSE FIX
  // ─────────────────────────────────────────────────────────────────────
  // Pre-v8.6 each ClipCard called useVideoPlayer(clip.videoUrl, ...) at
  // mount, so every card in the FlatList window (windowSize=3 →
  // 3–5 alive at once) allocated its own Android MediaCodec slot the
  // moment the hook ran — BEFORE isVisible was even evaluated. The
  // device has ~8 codec slots. On the SECOND/THIRD open of the Clips
  // tab the previously-mounted slots had not yet been released by the
  // OS (hook cleanup is async on native), the new mount couldn't get a
  // slot, and the native layer SIGABRTed inside libmedia — uncatchable
  // in JS. The visual "overlap" on first open was the same root cause:
  // two cards both held decoder surfaces while FlatList settled.
  //
  // The fix: lift useVideoPlayer to ClipsScreen so there is ONE player
  // for the entire screen. Active card attaches <VideoView player={
  // sharedPlayer} /> and gets the codec slot. Inactive cards render a
  // static gradient + title placeholder — zero native codecs in use.
  // Max one MediaCodec slot in flight at any time. The unreleased-slot
  // exhaustion path is removed entirely.

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

  // v8.5 P0 (round 2): the v8.4 handleMediaPress used a 310ms setTimeout
  // to differentiate single-tap-pause from double-tap-like. Result: a
  // single tap felt unresponsive (310ms is past the perception threshold
  // for "did anything happen?"), the user tapped again thinking nothing
  // had registered, second tap arrived inside the 300ms window → counted
  // as double-tap → like animation fired INSTEAD of pause. The pause
  // gesture was effectively unreachable. New behaviour: single tap
  // immediately toggles play/pause. Double-tap ALSO triggers like (in
  // addition to the toggle, which the user won't notice because the
  // toggle reverts on the second tap). Always-visible pause button in
  // the corner is the redundant always-works path.
  const handleMediaPress = useCallback(() => {
    const now = Date.now();
    const isDoubleTap = now - lastTapRef.current < 300;
    lastTapRef.current = now;
    onTogglePlay();
    if (isDoubleTap) {
      if (!isLiked) {
        onLike(clip.id);
      }
      showHeartAnimation();
    }
  }, [isLiked, onLike, clip.id, showHeartAnimation, onTogglePlay]);

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
        {/* v8.6 P0: only the ACTIVE card mounts <VideoView>. Inactive
            cards render the gradient placeholder + title preview only —
            zero MediaCodec slots in use. The shared player belongs to
            ClipsScreen; when activeClipId changes the parent calls
            sharedPlayer.replace() to swap source without re-allocating
            the codec. */}
        {isActive && sharedPlayer ? (
          <VideoView
            player={sharedPlayer}
            style={styles.video}
            nativeControls={false}
            contentFit="cover"
          />
        ) : (
          <View
            style={[styles.video, { backgroundColor: clip.bgColors[0] }]}
            // Gradient-coloured placeholder. Title overlay below gives
            // the card enough identity that the feed doesn't look blank
            // mid-scroll. Animated thumbnails can be added in a future
            // build once media_clips.thumbnail_url is generated server-
            // side at upload (see qa/pre-eas-build-checklist.md).
          />
        )}
        {/* Loading placeholder — masks the solid-black first paint that
            expo-video shows before the source is decoded. Only relevant
            when this card is active and the codec is preparing. */}
        {isActive && !isReady && (
          <View style={[styles.videoLoadingOverlay, { backgroundColor: clip.bgColors[0] }]}>
            <ActivityIndicator size="small" color="#fff" />
          </View>
        )}
        {isActive && isReady && !isPlaying && (
          <View style={styles.playOverlay}>
            <Text style={styles.playIcon}>▶</Text>
          </View>
        )}
        {/* Inactive cards: explicit "tap to play" affordance so users
            scrolling fast know the card is interactive. */}
        {!isActive && (
          <View style={styles.playOverlay}>
            <Text style={styles.playIcon}>▶</Text>
          </View>
        )}

        {/* v8.5 P0 (round 2): always-visible pause/play button in the top
            right. The gesture-only single-tap pause was unreliable
            (310ms delay made users think nothing happened). This is the
            redundant always-works path. Only shown on the ACTIVE card
            because inactive cards have no playback state of their own. */}
        {isActive && isReady && (
          <TouchableOpacity
            style={styles.pauseButton}
            onPress={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            activeOpacity={0.7}
          >
            {isPlaying ? (
              <Pause size={16} color="#fff" fill="#fff" />
            ) : (
              <Play size={16} color="#fff" fill="#fff" />
            )}
          </TouchableOpacity>
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
  // v8.6 P0: ONE shared player for the whole feed. Replaces the
  // per-card useVideoPlayer that exhausted MediaCodec slots and SIGABRTed
  // libmedia. The source is set to null on mount and the parent calls
  // sharedPlayer.replace() whenever activeClipId changes. The codec slot
  // is acquired the first time a clip becomes active and re-used for
  // every subsequent active clip — no allocation churn.
  const sharedPlayer = useVideoPlayer(null as any, (p) => {
    p.loop = true;
    p.muted = true;
  });
  const [isSharedPlaying, setIsSharedPlaying] = useState(false);
  const [isSharedReady, setIsSharedReady] = useState(false);
  // v8.7+ P0: user explicitly requested "stop clips auto-playing unless
  // user clicks play". Active-card detection still drives codec slot
  // allocation (no change to the MediaCodec exhaustion fix), but the
  // shared player now loads paused and waits for an explicit user tap on
  // the play overlay before starting playback. Once the user taps play
  // once in the session, subsequent active-card swaps auto-play (so the
  // feed still feels like a feed mid-scroll after the user has opted in).
  const [autoplayEnabled, setAutoplayEnabled] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);
  const [likedClipIds, setLikedClipIds] = useState<Set<string>>(new Set());
  // v8.5 P0 (round 2): switched from a Set of "visible" ids to a single
  // active id. The v8.4 50% visibility threshold + Set let multiple
  // ClipCards see isVisible=true during a scroll, all calling
  // player.play() concurrently. Android MediaCodec has ~8 slots; this
  // saturated them and crashed the app from libmedia (uncatchable in
  // JS). Now: at most ONE clip is "active" → at most ONE MediaCodec
  // decode in flight. Others paint a still placeholder.
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  // Custom share sheet (v8.3): TikTok / IG Stories / Copy Link / More apps.
  // The sheet wraps the legacy expo-sharing system-share path as its
  // "More apps..." row, so existing behavior remains as a fallback.
  const [shareTarget, setShareTarget] = useState<ClipDisplay | null>(null);

  // v8.6 P0: when activeClipId changes, swap the shared player's source.
  // This is the single point of codec-source mutation; per-card effects
  // are gone. If activeClipId is null (none visible), we pause; we do NOT
  // call replace(null) because some expo-video releases dispose the
  // codec, which the next play call would have to re-acquire. Keeping
  // the last source loaded but paused makes the next active swap cheap.
  useEffect(() => {
    if (!sharedPlayer) return;
    const clip = clips.find((c) => c.id === activeClipId);
    if (!activeClipId || !clip || !clip.videoUrl) {
      try { sharedPlayer.pause(); } catch { /* ignore */ }
      setIsSharedPlaying(false);
      return;
    }
    setIsSharedReady(false);
    try {
      sharedPlayer.replace({ uri: clip.videoUrl });
      // v8.7+ P0: only auto-play once the user has opted into playback for
      // the session. Source still LOADS so the active card paints the
      // first frame quickly when the user does tap play — but nothing
      // starts playing without an explicit gesture on first view.
      if (autoplayEnabled) {
        sharedPlayer.play();
        setIsSharedPlaying(true);
      } else {
        sharedPlayer.pause();
        setIsSharedPlaying(false);
      }
    } catch {
      /* native release / dispose race — next viewability tick will retry */
    }
    // We intentionally do not depend on `clips` array reference here
    // because every Realtime patch produces a new reference and would
    // re-fire this effect, churning sources. activeClipId is stable until
    // the user actually scrolls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClipId, sharedPlayer, autoplayEnabled]);

  // Subscribe to shared-player status for the active card's "loading…"
  // overlay. The listener is registered against the SHARED player so we
  // only have one subscription for the whole feed — there is no per-card
  // listener churn anymore.
  useEffect(() => {
    if (!sharedPlayer) return;
    const sub = sharedPlayer.addListener('statusChange', ({ status }) => {
      setIsSharedReady(status === 'readyToPlay');
    });
    return () => {
      try { sub.remove(); } catch { /* ignore */ }
    };
  }, [sharedPlayer]);

  const toggleSharedPlay = useCallback(() => {
    if (!sharedPlayer) return;
    if (isSharedPlaying) {
      try { sharedPlayer.pause(); } catch { /* ignore */ }
      setIsSharedPlaying(false);
    } else {
      try {
        sharedPlayer.play();
        setIsSharedPlaying(true);
        // First explicit play tap opts the session into autoplay so the
        // next clip the user scrolls into starts automatically (matches
        // expected TikTok/IG-style behaviour AFTER the user has signaled
        // intent to watch).
        if (!autoplayEnabled) setAutoplayEnabled(true);
      } catch { /* ignore */ }
    }
  }, [isSharedPlaying, sharedPlayer, autoplayEnabled]);

  // On Clips tab unfocus, pause the shared player so audio doesn't bleed
  // into other tabs. The codec slot is retained so re-focus is instant.
  useFocusEffect(
    useCallback(() => {
      return () => {
        try { sharedPlayer?.pause(); } catch { /* ignore */ }
        setIsSharedPlaying(false);
      };
    }, [sharedPlayer])
  );

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
    // v8.7+ P0: the chat-bubble icon next to Heart was wired to a no-op
    // handler — taps did nothing and the user (correctly) thought it was
    // broken. Until comments ship, surface an explicit "coming soon"
    // alert so the affordance is honest about its state.
    Alert.alert('Coming soon', 'Comments on clips are launching in a future update — stay tuned!');
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

  // v8.5 P0 (round 2): pick the SINGLE most-visible clip — the one
  // closest to the centre of the viewport. Threshold bumped to 80% so
  // mid-scroll snapshots don't flip the active clip every frame (which
  // would tear down and re-spin players, the v8.3 crash path). Only when
  // a clip is truly the dominant card on screen does it become active.
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length === 0) {
        setActiveClipId(null);
        return;
      }
      // viewableItems is sorted by index; the first item is the topmost
      // visible card, which on a vertical feed is the one the user is
      // actively watching. Use its id.
      const topId = viewableItems[0]?.item?.id;
      if (topId) setActiveClipId(topId);
    }
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 80,
    minimumViewTime: 150,
  }).current;

  const renderClipItem = useCallback(
    ({ item }: { item: ClipDisplay }) => {
      const isActive = item.id === activeClipId;
      return (
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
          isActive={isActive}
          isFollowingPoster={followedUserIds.has(item.userId)}
          isOwner={!!currentUserId && item.userId === currentUserId}
          // The shared player is only handed to the active card so
          // inactive ones cannot mistakenly mount <VideoView> against it
          // and double-attach the codec.
          sharedPlayer={isActive ? sharedPlayer : null}
          isPlaying={isActive ? isSharedPlaying : false}
          isReady={isActive ? isSharedReady : false}
          onTogglePlay={toggleSharedPlay}
        />
      );
    },
    [likedClipIds, handleLike, handleShare, handleComment, activeClipId, handleDelete, handleBlock, currentUserId, handleExport, handleFollow, followedUserIds, sharedPlayer, isSharedPlaying, isSharedReady, toggleSharedPlay]
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
          // ClipCards spin up per scroll tick. Stable per-card player
          // (line 90) is what actually prevents the MediaCodec exhaustion
          // crash — the virtualization is belt-and-braces.
          //
          // CRITICAL: removeClippedSubviews intentionally OMITTED. On
          // Android it has well-documented render-position bugs that
          // caused the v8.3 UAT artifact where Card 2's video painted
          // under Card 1's caption bar. Cards just hide off-screen via
          // the standard FlatList recycling instead.
          windowSize={3}
          maxToRenderPerBatch={2}
          initialNumToRender={2}
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
  pauseButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
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
