// Player buffer budgets.
//
// Stability fix 1/2 (2026-09-23 investigation). expo-video ships ExoPlayer's
// DefaultLoadControl untouched: a 50-second forward buffer with a target of
// 2000 x 64 KB (128 MB) of video plus 12.8 MB of audio PER PLAYER, and those
// buffers are Java `byte[]` segments -- they live inside the app's 256 MB
// Java heap, not in native memory. A 30 s FHD recording (~60 MB at the
// bitrates these phones produce) fits entirely inside that window, so the
// New Clip preview alone could hold the whole file on the heap while the
// Clips feed player underneath it held the last remote clip. That is the
// leading hypothesis for the fatal OutOfMemoryError on the Galaxy S10+.
//
// These clips are at most 30 s long and play from the start, so a few
// seconds of look-ahead is all a smooth experience needs. On Android the
// byte cap is what bounds the heap; on iOS only the duration applies.
//
// The numbers here are a hypothesis under test, not a tuned result: the
// runtime validation procedure in the Phase 1 report measures the heap with
// and without them. Change them there, not in call sites.

import type { BufferOptions } from 'expo-video';

const MB = 1024 * 1024;

/**
 * Shared Clips feed player: one player for the whole feed, source swapped
 * per active card. Remote MP4s, short, usually watched from the top.
 */
export const CLIP_FEED_BUFFER_OPTIONS: BufferOptions = {
  preferredForwardBufferDuration: 5,
  maxBufferBytes: 8 * MB,
  // Stop buffering when either the 5 s or the 8 MB limit is hit, whichever
  // comes first. Set explicitly so a preset change cannot let time win and
  // blow through the byte cap (expo-video SDK 54 typings: default false).
  // Android only, like maxBufferBytes: on iOS only the 5 s forward-buffer
  // duration applies, so the heap cap is an Android fix and iOS memory
  // must be measured separately (Instruments), not inferred from the S10+.
  prioritizeTimeOverSizeThreshold: false,
};

/**
 * New Clip preview: a local file at full recording bitrate, looping and
 * muted. Same budget -- the file is on disk, re-reading it is cheap, and
 * the preview only exists to confirm "this is the clip I meant".
 */
export const CLIP_PREVIEW_BUFFER_OPTIONS: BufferOptions = {
  preferredForwardBufferDuration: 5,
  maxBufferBytes: 8 * MB,
  prioritizeTimeOverSizeThreshold: false,
};
