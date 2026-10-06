import type { Song } from '../../core/Song';
import { EngineEvents, type EngineEvent, type EngineListener, type PlaybackEngine } from '../PlaybackEngine';
import { spotifyLog } from './log';
import type { SpotifySession } from './session';
import { detectTrackEnd, endCheckDelay, interpolatePosition, type TrackSnapshot } from './trackEnd';

/** How often to ask the SDK for the real position while playing. */
const RESYNC_MS = 1000;
/** How often to emit 'timeupdate' (the position itself is interpolated every frame). */
const TIMEUPDATE_MS = 250;

/**
 * PlaybackEngine for Spotify songs, on top of the Web Playback SDK. It plays only
 * the single uri it is given: our PlaybackQueue decides what comes next, so if
 * Spotify starts another track by itself, it is paused and reported as 'ended'.
 */
export class SpotifyEngine implements PlaybackEngine {
  readonly kind = 'spotify' as const;
  private readonly events = new EngineEvents();
  private uri: string | null = null;
  private durationMs = 0;
  /** Where to start when play() is first called (restored position, or a seek before playing). */
  private pendingPositionMs = 0;
  /** play() was requested for the loaded uri (so state changes belong to us). */
  private started = false;
  private ended = false;
  private isPaused = true;
  /** Last state reported for our track, and when it arrived (performance.now()). */
  private last: { snapshot: TrackSnapshot; at: number } | null = null;
  /** Increases on every load, so late answers for an old song are ignored. */
  private loadToken = 0;
  private frame = 0;
  /** Timer that checks for the end of the track (see scheduleEndCheck). */
  private endCheck = 0;
  private lastTimeupdate = 0;
  private lastResync = 0;

  constructor(private readonly session: SpotifySession) {
    session.player?.onStateChange((state) => this.onState(state));
    session.player?.onStatus((status) => {
      if (status.kind === 'error' && this.uri && this.started) this.events.emit('error', status.message);
    });
  }

  get paused(): boolean {
    return this.isPaused;
  }

  get duration(): number {
    return this.durationMs / 1000;
  }

  /** Interpolated from the last state change, so it moves smoothly between SDK events. */
  get currentTime(): number {
    if (!this.last) return this.pendingPositionMs / 1000;
    return interpolatePosition(this.last.snapshot, performance.now() - this.last.at) / 1000;
  }

  on(event: EngineEvent, listener: EngineListener): () => void {
    return this.events.on(event, listener);
  }

  load(song: Song, startAt = 0): void {
    if (song.source !== 'spotify') throw new Error('SpotifyEngine only plays Spotify songs.');
    this.loadToken++;
    if (this.started && !this.isPaused) void this.session.player?.pause();
    this.uri = song.spotifyUri;
    this.durationMs = song.duration * 1000;
    this.pendingPositionMs = startAt * 1000;
    this.started = false;
    this.ended = false;
    this.last = null;
    this.setPaused(true);
    this.events.emit('timeupdate');
  }

  unload(): void {
    this.loadToken++;
    if (this.started && !this.isPaused) void this.session.player?.pause();
    this.uri = null;
    this.started = false;
    this.last = null;
    this.setPaused(true);
  }

  async play(): Promise<boolean> {
    const uri = this.uri;
    if (!uri || !this.session.player) return false;
    const token = this.loadToken;
    try {
      if (!this.started || this.ended) {
        // First play of this song (or again after it ended): ask Spotify for exactly this uri.
        const position = this.ended ? 0 : this.pendingPositionMs;
        this.started = true;
        this.ended = false;
        await this.session.playUri(uri, position);
      } else {
        await this.session.player.resume();
      }
      return token === this.loadToken;
    } catch (error) {
      if (token !== this.loadToken) return false;
      this.started = false;
      const message = error instanceof Error ? error.message : String(error);
      spotifyLog('play failed:', message);
      this.events.emit('error', message);
      return false;
    }
  }

  pause(): void {
    if (this.started) void this.session.player?.pause();
    this.setPaused(true);
  }

  seek(seconds: number): void {
    const positionMs = Math.max(0, seconds * 1000);
    if (!this.started || this.ended) {
      this.pendingPositionMs = positionMs;
      if (this.ended) this.ended = false;
      this.started = false;
      this.last = null;
      this.events.emit('timeupdate');
      return;
    }
    void this.session.player?.seek(positionMs);
    if (this.last) this.last = { snapshot: { ...this.last.snapshot, positionMs }, at: performance.now() };
    this.events.emit('timeupdate');
  }

  setVolume(volume: number): void {
    void this.session.player?.setVolume(volume);
  }

  // ---- SDK state → engine events ----

  private onState(state: Spotify.PlaybackState | null): void {
    if (!this.uri || !this.started) return;
    // A null state (nothing playing on this device) can be the only report after a
    // single-track playback finishes: it counts as an empty player, which ends our
    // track only if it was near its end.
    const track = state?.track_window.current_track ?? null;
    // A relinked track (other market) reports another uri but links back to ours.
    const reportedUri = track ? (track.linked_from?.uri ?? track.uri) : null;
    const snapshot: TrackSnapshot = state
      ? {
          uri: reportedUri === this.uri || track?.uri === this.uri ? this.uri : reportedUri,
          paused: state.paused,
          positionMs: state.position,
          durationMs: state.duration || this.durationMs,
        }
      : { uri: null, paused: true, positionMs: 0, durationMs: this.durationMs };
    const previous = this.last
      ? { ...this.last.snapshot, positionMs: interpolatePosition(this.last.snapshot, performance.now() - this.last.at) }
      : null;
    const end = this.ended ? null : detectTrackEnd(this.uri, previous, snapshot);

    if (end) {
      spotifyLog('track end detected:', end);
      this.ended = true;
      if (end === 'switched') void this.session.player?.pause(); // our queue decides what plays next
      this.last = previous ? { snapshot: { ...previous, paused: true }, at: performance.now() } : null;
      this.setPaused(true);
      this.events.emit('ended');
      return;
    }
    if (snapshot.uri !== this.uri) return; // still the previous track; ours has not started yet

    this.last = { snapshot, at: performance.now() };
    if (snapshot.durationMs) this.durationMs = snapshot.durationMs;
    this.setPaused(snapshot.paused);
    this.scheduleEndCheck(snapshot);
    this.events.emit('timeupdate');
  }

  /**
   * The per-frame re-sync stops in background tabs (no animation frames), so a
   * timer also asks the player for its state right after the expected end: the
   * last track of the queue is never left without its 'ended'.
   */
  private scheduleEndCheck(snapshot: TrackSnapshot): void {
    window.clearTimeout(this.endCheck);
    const delay = endCheckDelay(snapshot, snapshot.positionMs);
    if (delay === null) return;
    const token = this.loadToken;
    this.endCheck = window.setTimeout(() => {
      if (token !== this.loadToken || this.ended) return;
      void this.session.player?.getCurrentState().then((state) => {
        if (token === this.loadToken) this.onState(state);
      });
    }, delay);
  }

  private setPaused(paused: boolean): void {
    if (paused === this.isPaused) return;
    this.isPaused = paused;
    if (paused) {
      cancelAnimationFrame(this.frame);
      window.clearTimeout(this.endCheck);
      this.frame = 0;
    } else if (!this.frame) {
      this.frame = requestAnimationFrame(this.tick);
    }
    this.events.emit(paused ? 'pause' : 'play');
  }

  /** While playing: emit interpolated timeupdates and re-sync with the SDK every second. */
  private readonly tick = (time: number): void => {
    this.frame = 0;
    if (this.isPaused || !this.uri) return;
    if (time - this.lastTimeupdate >= TIMEUPDATE_MS) {
      this.lastTimeupdate = time;
      this.events.emit('timeupdate');
    }
    if (time - this.lastResync >= RESYNC_MS) {
      this.lastResync = time;
      void this.session.player?.getCurrentState().then((state) => this.onState(state));
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}
