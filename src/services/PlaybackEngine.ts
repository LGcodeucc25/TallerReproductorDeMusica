import type { Song } from '../core/Song';

export type EngineEvent = 'timeupdate' | 'play' | 'pause' | 'ended' | 'error';

/** `error` listeners receive a message when the engine has one (for example Spotify's exact text). */
export type EngineListener = (message?: string) => void;

/**
 * What the app needs from something that plays songs. LocalAudioEngine plays
 * imported files; SpotifyEngine plays Spotify tracks through the Web Playback SDK.
 * The queue, repeat and shuffle never know which one is playing.
 */
export interface PlaybackEngine {
  readonly kind: Song['source'];
  /** Prepares a song without starting it. */
  load(song: Song, startAt?: number): void;
  /** Stops and forgets the loaded song. */
  unload(): void;
  /** Starts or resumes; resolves false if the browser or the service refused. */
  play(): Promise<boolean>;
  pause(): void;
  seek(seconds: number): void;
  /** 0–1. Mute is volume 0, decided by the app. */
  setVolume(volume: number): void;
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  on(event: EngineEvent, listener: EngineListener): () => void;
}

/** Tiny event emitter shared by the engines. */
export class EngineEvents {
  private readonly listeners = new Map<EngineEvent, Set<EngineListener>>();

  on(event: EngineEvent, listener: EngineListener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  emit(event: EngineEvent, message?: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener(message);
  }
}
