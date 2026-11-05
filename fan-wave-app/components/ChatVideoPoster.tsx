/**
 * Poster frame for a chat video bubble.
 *
 * 2026-11-05, found while capturing Android store screenshots on native
 * build 37: video messages rendered as a solid black tile with only the
 * ▶ overlay on top.
 *
 * Cause: the bubble did `<RNImage source={{ uri: thumbnailUrl ||
 * mediaUrl }} />`. React Native's Image cannot decode an mp4, so for any
 * row without `thumbnail_url` the source was a video URL and the decode
 * failed silently, leaving the view's black background. New uploads have
 * generated a thumbnail since v9.4.0, but every legacy row predates that
 * and still has `thumbnail_url = null`.
 *
 * Fix, client-side only: when there is no usable poster, pull one frame
 * out of the video with `expo-video-thumbnails` (already a dependency,
 * already used by the upload path and create-clip). If that fails too,
 * show a labelled placeholder instead of black, so the tile reads as
 * "a video" rather than as a broken or empty message.
 *
 * Bounded by construction:
 *   - one extraction per media URL per session, cached module-side
 *     (successes and failures both), so re-renders and re-mounts while
 *     scrolling never re-extract;
 *   - concurrent mounts of the same URL share one in-flight promise;
 *   - the extraction is wrapped in a timeout, because a slow remote
 *     video must not leave the tile spinning indefinitely.
 *
 * Tapping is unchanged: this renders only the poster surface. The
 * caller keeps its TouchableOpacity and `ChatMediaPreview` keeps
 * ownership of playback.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image as RNImage,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
} from 'react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Colors } from '@/constants/Colors';
import { withTimeout } from '@/lib/withTimeout';
import { addBreadcrumb } from '@/lib/errorReporting';

/**
 * Frame extraction decodes the head of a remote file. Long enough for a
 * cold fetch on a slow connection, short enough that the tile settles
 * into the placeholder rather than spinning forever.
 */
export const POSTER_EXTRACT_TIMEOUT_MS = 10_000;

/** Cap the session cache so a long scrollback cannot grow it unbounded. */
const MAX_CACHED_POSTERS = 200;

/** `string` = extracted poster uri, `null` = extraction already failed. */
const posterCache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

function cachePoster(mediaUrl: string, uri: string | null): void {
  if (posterCache.has(mediaUrl)) posterCache.delete(mediaUrl);
  posterCache.set(mediaUrl, uri);
  while (posterCache.size > MAX_CACHED_POSTERS) {
    const oldest = posterCache.keys().next();
    if (oldest.done) break;
    posterCache.delete(oldest.value);
  }
}

/**
 * Extract (or reuse) a poster frame for `mediaUrl`.
 *
 * Resolves to `null` rather than rejecting when extraction is not
 * possible, so every caller has one branch for "no poster".
 */
export async function getPosterForVideo(mediaUrl: string): Promise<string | null> {
  if (!mediaUrl) return null;
  if (posterCache.has(mediaUrl)) return posterCache.get(mediaUrl) ?? null;

  const existing = inFlight.get(mediaUrl);
  if (existing) return existing;

  const task = (async () => {
    try {
      const { uri } = await withTimeout(
        () => VideoThumbnails.getThumbnailAsync(mediaUrl, { time: 0, quality: 0.7 }),
        POSTER_EXTRACT_TIMEOUT_MS,
      );
      const poster = uri || null;
      cachePoster(mediaUrl, poster);
      return poster;
    } catch (e) {
      // Expected for rows whose media is gone, is not really a video, or
      // sits behind an expired signed URL. The placeholder is the answer,
      // not an error dialog.
      cachePoster(mediaUrl, null);
      addBreadcrumb('chat', 'video_poster.extract_failed', {
        detail: e instanceof Error ? e.message : String(e),
      });
      return null;
    } finally {
      inFlight.delete(mediaUrl);
    }
  })();

  inFlight.set(mediaUrl, task);
  return task;
}

export interface ChatVideoPosterProps {
  mediaUrl: string;
  /** `thumbnail_url` from the row, when the upload path recorded one. */
  thumbnailUrl?: string | null;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'center' | 'stretch' | 'repeat';
  /** Test seam so the placeholder can be asserted without native mocks. */
  testID?: string;
}

export default function ChatVideoPoster({
  mediaUrl,
  thumbnailUrl,
  style,
  resizeMode = 'cover',
  testID,
}: ChatVideoPosterProps) {
  // A supplied thumbnail is trusted until the decode actually fails;
  // `supplied` going false is what lets a broken legacy URL fall through
  // to extraction instead of staying black.
  const [supplied, setSupplied] = useState<string | null>(thumbnailUrl || null);
  const [extracted, setExtracted] = useState<string | null>(
    () => (thumbnailUrl ? null : posterCache.get(mediaUrl) ?? null),
  );
  const [resolving, setResolving] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    setSupplied(thumbnailUrl || null);
  }, [thumbnailUrl, mediaUrl]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Only reach for a frame when there is no usable poster. A cached
    // result (including a cached failure) short-circuits without work.
    if (supplied || !mediaUrl) return;
    if (posterCache.has(mediaUrl)) {
      setExtracted(posterCache.get(mediaUrl) ?? null);
      return;
    }
    let cancelled = false;
    setResolving(true);
    void getPosterForVideo(mediaUrl).then((uri) => {
      if (cancelled || !mounted.current) return;
      setExtracted(uri);
      setResolving(false);
    });
    return () => {
      cancelled = true;
    };
  }, [supplied, mediaUrl]);

  const uri = supplied || extracted;

  if (uri) {
    return (
      <RNImage
        testID={testID ? `${testID}-image` : undefined}
        source={{ uri }}
        style={style}
        resizeMode={resizeMode}
        onError={() => {
          // A thumbnail URL that 404s or is not an image: drop it and let
          // the extraction path have a go. Guarded so an extracted frame
          // that also fails to decode cannot loop.
          if (supplied) setSupplied(null);
        }}
      />
    );
  }

  return (
    <View testID={testID ? `${testID}-placeholder` : undefined} style={[styles.placeholder, style]}>
      {resolving ? (
        <ActivityIndicator color={Colors.dark.accentLight} />
      ) : (
        <Text style={styles.placeholderLabel}>Video</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Deliberately not black: black is what the bug looked like, and a
  // tile that reads as "deliberate surface" is distinguishable from a
  // tile that failed to load.
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.surfaceLight,
  },
  placeholderLabel: {
    color: Colors.dark.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
});

/** Test seam. Not used by app code. */
export function __resetPosterCache(): void {
  posterCache.clear();
  inFlight.clear();
}
