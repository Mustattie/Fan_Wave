// Clips feed audio policy (Build 31 UAT, 2026-09-25).
//
// The Clips tab owns ONE expo-video player (app/(tabs)/clips.tsx). Only the
// active card mounts a VideoView against it; inactive cards are posters and
// have no player at all, so they can never output audio. That player was
// created with `muted = true` in v8.7+ (284eda4, 2026-06-23) and nothing
// ever unmuted it, so every build since -- Build 30 included -- played
// clips silently. Uploaded clips do carry an AAC track.
//
// Intended behaviour, encoded here so it is testable without the screen:
//   * the active card's player is audible while the app is in the
//     foreground and the user has not muted the feed
//   * the feed mute is a user preference that persists across launches
//   * backgrounding silences the player before it is released; returning
//     restores the user's preference (the player comes back paused anyway)
//   * there is exactly one audio owner at any moment: the active card

export const CLIPS_MUTED_KEY = 'clips_muted';

export interface FeedAudioState {
  /** The user tapped the speaker icon. Persisted. */
  userMuted: boolean;
  /** AppState is 'active'. */
  appActive: boolean;
}

/** Whether the shared feed player must be muted for this state. */
export function feedPlayerMuted(state: FeedAudioState): boolean {
  return state.userMuted || !state.appActive;
}

/**
 * Which card may output audio: the active one, and only while the player
 * is audible. Everything else is silent by construction (no player).
 */
export function audioOwner(activeClipId: string | null, state: FeedAudioState): string | null {
  if (!activeClipId) return null;
  return feedPlayerMuted(state) ? null : activeClipId;
}

export interface MutablePlayer {
  muted: boolean;
}

/**
 * Binds the policy to the one player. Writes `muted` only when it changes
 * so a re-render never touches the native player needlessly.
 */
export class FeedAudioController {
  private state: FeedAudioState = { userMuted: false, appActive: true };

  constructor(private readonly player: MutablePlayer, initial?: Partial<FeedAudioState>) {
    this.apply(initial ?? {});
  }

  get current(): FeedAudioState {
    return { ...this.state };
  }

  /** Update part of the state and push the resulting mute flag to the player. */
  apply(partial: Partial<FeedAudioState>): boolean {
    this.state = { ...this.state, ...partial };
    const muted = feedPlayerMuted(this.state);
    try {
      if (this.player.muted !== muted) this.player.muted = muted;
    } catch {
      /* player mid-release: the next apply() re-asserts the flag */
    }
    return muted;
  }
}

/** Serialise / parse the persisted preference. */
export function serializeMuted(muted: boolean): string {
  return muted ? '1' : '0';
}
export function parseMuted(raw: string | null | undefined): boolean {
  return raw === '1';
}
