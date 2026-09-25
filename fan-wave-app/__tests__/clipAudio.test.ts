/**
 * Build 31 physical UAT (2026-09-25): Clips played video with no audio on
 * the Galaxy S10+ (retrospectively also on Build 30). The one shared feed
 * player had been created `muted = true` since v8.7+ and nothing unmuted
 * it. lib/clipAudio.ts now owns the flag; these tests pin the policy.
 */
import {
  FeedAudioController,
  audioOwner,
  feedPlayerMuted,
  parseMuted,
  serializeMuted,
  CLIPS_MUTED_KEY,
} from '../lib/clipAudio';
import { SharedVideoSource } from '../lib/sharedVideoSource';

function fakePlayer(initialMuted = true) {
  const writes: boolean[] = [];
  const p = {
    _muted: initialMuted,
    get muted() {
      return this._muted;
    },
    set muted(v: boolean) {
      writes.push(v);
      this._muted = v;
    },
    writes,
  };
  return p;
}

describe('Clips feed audio policy', () => {
  it('active clip: audible while foregrounded and not user-muted (the Build 31 defect)', () => {
    const p = fakePlayer(true); // how the player used to be created
    const audio = new FeedAudioController(p);
    expect(p.muted).toBe(false);
    expect(audioOwner('clip-a', audio.current)).toBe('clip-a');
  });

  it('inactive clips are never audio owners; only the active id is', () => {
    const state = { userMuted: false, appActive: true };
    const cards = ['a', 'b', 'c'];
    const owners = cards.map((id) => audioOwner('b', state) === id);
    expect(owners).toEqual([false, true, false]);
    expect(owners.filter(Boolean)).toHaveLength(1);
    expect(audioOwner(null, state)).toBeNull();
  });

  it('A -> B transition moves the single audio owner without a second player', () => {
    const p = fakePlayer();
    const audio = new FeedAudioController(p);
    const source = new SharedVideoSource({ replaceAsync: jest.fn(async () => undefined) });
    expect(audioOwner('a', audio.current)).toBe('a');
    // Scrolling swaps the source on the SAME player; no new controller, no
    // new player, so overlapping audio is impossible.
    return source.load('https://cdn/b.mp4').then(() => {
      expect(audioOwner('b', audio.current)).toBe('b');
      expect(audioOwner('a', { ...audio.current })).toBe('a'); // policy is id-relative...
      // ...but the screen only ever asks for the active id, and there is one:
      const activeAfterScroll = 'b';
      expect(['a', 'b'].filter((id) => audioOwner(activeAfterScroll, audio.current) === id)).toEqual(['b']);
      expect(p.muted).toBe(false);
      expect(p.writes).toEqual([false]); // one native write for the whole sequence
    });
  });

  it('mute / unmute controls the active player and round-trips through storage', () => {
    const p = fakePlayer();
    const audio = new FeedAudioController(p);
    expect(audio.apply({ userMuted: true })).toBe(true);
    expect(p.muted).toBe(true);
    expect(audioOwner('a', audio.current)).toBeNull();
    expect(audio.apply({ userMuted: false })).toBe(false);
    expect(p.muted).toBe(false);
    expect(parseMuted(serializeMuted(true))).toBe(true);
    expect(parseMuted(serializeMuted(false))).toBe(false);
    expect(parseMuted(null)).toBe(false);
    expect(CLIPS_MUTED_KEY).toBe('clips_muted');
  });

  it('background silences before release; foreground restores the preference', async () => {
    const p = fakePlayer();
    const audio = new FeedAudioController(p);
    const replaceAsync = jest.fn(async () => undefined);
    const source = new SharedVideoSource({ replaceAsync });
    await source.load('https://cdn/a.mp4');

    // Background (the screen applies appActive:false, then pauses, then releases).
    expect(audio.apply({ appActive: false })).toBe(true);
    expect(p.muted).toBe(true);
    await source.release();
    expect(replaceAsync).toHaveBeenLastCalledWith(null);
    expect(source.currentUri).toBeNull(); // cleanup still happens

    // Foreground: preference restored (not muted); playback resumes paused
    // by the screen, so nothing plays until the user taps.
    expect(audio.apply({ appActive: true })).toBe(false);
    expect(p.muted).toBe(false);

    // A user who muted stays muted across the same cycle.
    audio.apply({ userMuted: true });
    audio.apply({ appActive: false });
    audio.apply({ appActive: true });
    expect(p.muted).toBe(true);
  });

  it('writes the native flag only when it changes', () => {
    const p = fakePlayer(false);
    const audio = new FeedAudioController(p);
    audio.apply({ appActive: true });
    audio.apply({ appActive: true });
    audio.apply({ userMuted: false });
    expect(p.writes).toEqual([]);
    audio.apply({ userMuted: true });
    expect(p.writes).toEqual([true]);
  });

  it('feedPlayerMuted truth table', () => {
    expect(feedPlayerMuted({ userMuted: false, appActive: true })).toBe(false);
    expect(feedPlayerMuted({ userMuted: true, appActive: true })).toBe(true);
    expect(feedPlayerMuted({ userMuted: false, appActive: false })).toBe(true);
    expect(feedPlayerMuted({ userMuted: true, appActive: false })).toBe(true);
  });
});
