// Source loading for the shared Clips feed player.
//
// Stability fix 3 (2026-09-23 investigation). The feed used
// `player.replace({ uri })` inside an effect keyed on the active card. On
// iOS `replace` loads the asset synchronously on the main thread (expo-video
// warns on every call, which is the breadcrumb flood in Sentry), and the
// effect had no cleanup, no dedupe and no notion of a stale load:
//
//   * the first play tap flipped `autoplayEnabled`, re-ran the effect and
//     re-loaded the clip that was already loaded, calling play() twice;
//   * scrolling A -> B -> A reloaded A;
//   * with an async load, a slow load of A could resolve after the user had
//     scrolled to B and start playing A over B's card.
//
// This class owns those rules so the screen only decides play vs pause:
//
//   load(uri)  -> 'same'   the player already has this uri; nothing loaded
//              -> 'loaded' this call's load finished and is still current
//              -> 'stale'  a newer load() or release() superseded it
//              -> 'error'  the load failed and is still current (report it)
//   release()  drops the source (background), so the next load() reloads.
//
// It deliberately knows nothing about React; it is unit-tested in
// __tests__/sharedVideoSource.test.ts with a fake player.

export interface SourcePlayerLike {
  replaceAsync(source: { uri: string } | null): Promise<void>;
}

export type LoadOutcome = 'same' | 'loaded' | 'stale' | 'error';

export class SharedVideoSource {
  private generation = 0;
  private loadedUri: string | null = null;
  private inFlightUri: string | null = null;

  constructor(private readonly player: SourcePlayerLike) {}

  /** The uri whose load last completed, or null after release(). */
  get currentUri(): string | null {
    return this.loadedUri;
  }

  /** The uri of the load in progress, if any. */
  get pendingUri(): string | null {
    return this.inFlightUri;
  }

  async load(uri: string, options: { force?: boolean } = {}): Promise<{ outcome: LoadOutcome; error?: unknown }> {
    if (!options.force) {
      if (this.loadedUri === uri && this.inFlightUri === null) return { outcome: 'same' };
      // A load of this exact uri is already in progress; let it finish
      // rather than issuing a second one.
      if (this.inFlightUri === uri) return { outcome: 'stale' };
    }

    const generation = ++this.generation;
    this.inFlightUri = uri;
    try {
      await this.player.replaceAsync({ uri });
      if (generation !== this.generation) return { outcome: 'stale' };
      this.loadedUri = uri;
      this.inFlightUri = null;
      return { outcome: 'loaded' };
    } catch (error) {
      if (generation !== this.generation) return { outcome: 'stale' };
      this.inFlightUri = null;
      return { outcome: 'error', error };
    }
  }

  /**
   * Invalidate any load in progress without touching the player. Used when
   * the active card goes away (nothing visible) so a late resolve cannot
   * start playback.
   */
  invalidate(): void {
    this.generation += 1;
    this.inFlightUri = null;
  }

  /**
   * Drop the loaded source so its decoder and buffers can go. Only called
   * when nothing is on screen (app background): the code base documents an
   * Android codec-dispose race when a source is cleared while a VideoView
   * is attached, which is why tab blur only pauses.
   */
  async release(): Promise<void> {
    this.generation += 1;
    this.inFlightUri = null;
    this.loadedUri = null;
    try {
      await this.player.replaceAsync(null);
    } catch {
      /* best-effort: a player mid-teardown may reject; nothing to keep */
    }
  }
}
