import type { Song } from '../core/Song';
import { EngineEvents, type EngineEvent, type EngineListener, type PlaybackEngine } from './PlaybackEngine';

/**
 * Plays imported files with an <audio> element and feeds the Web Audio analyser
 * used by the visualizer. Songs play from in-memory object URLs: files never leave the computer.
 */
export class LocalAudioEngine implements PlaybackEngine {
  readonly kind = 'local' as const;
  readonly element: HTMLAudioElement = new Audio();
  private readonly events = new EngineEvents();
  private objectUrl: string | null = null;
  private context: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;

  constructor() {
    this.element.preload = 'auto';
    const forward: [keyof HTMLMediaElementEventMap, EngineEvent][] = [
      ['timeupdate', 'timeupdate'],
      ['loadedmetadata', 'timeupdate'],
      ['play', 'play'],
      ['pause', 'pause'],
      ['ended', 'ended'],
    ];
    for (const [domEvent, event] of forward) this.element.addEventListener(domEvent, () => this.events.emit(event));
    this.element.addEventListener('error', () => {
      if (this.objectUrl) this.events.emit('error');
    });
  }

  get paused(): boolean {
    return this.element.paused;
  }

  get currentTime(): number {
    return this.element.currentTime;
  }

  get duration(): number {
    const value = this.element.duration;
    return Number.isFinite(value) ? value : 0;
  }

  get analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  on(event: EngineEvent, listener: EngineListener): () => void {
    return this.events.on(event, listener);
  }

  load(song: Song, startAt = 0): void {
    if (song.source !== 'local') throw new Error('LocalAudioEngine only plays local songs.');
    this.releaseUrl();
    this.objectUrl = URL.createObjectURL(song.file);
    this.element.src = this.objectUrl;
    if (startAt > 0) {
      this.element.addEventListener(
        'loadedmetadata',
        () => {
          if (startAt < this.element.duration) this.element.currentTime = startAt;
        },
        { once: true },
      );
    }
  }

  unload(): void {
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
    this.releaseUrl();
  }

  async play(): Promise<boolean> {
    if (!this.objectUrl) return false;
    this.ensureAnalyser();
    try {
      await this.context?.resume();
      await this.element.play();
      return true;
    } catch {
      return false;
    }
  }

  pause(): void {
    this.element.pause();
  }

  seek(seconds: number): void {
    if (!this.objectUrl) return;
    const limit = this.duration || seconds;
    this.element.currentTime = Math.min(Math.max(0, seconds), limit);
  }

  setVolume(volume: number): void {
    this.element.volume = Math.min(1, Math.max(0, volume));
  }

  /** The AudioContext must be created after a user gesture, so it is built lazily. */
  private ensureAnalyser(): void {
    if (this.context || typeof AudioContext === 'undefined') return;
    try {
      this.context = new AudioContext();
      const source = this.context.createMediaElementSource(this.element);
      this.analyserNode = this.context.createAnalyser();
      // 1024 frequency bins: enough resolution for a log-scale spectrum from 40 Hz to 16 kHz.
      this.analyserNode.fftSize = 2048;
      this.analyserNode.smoothingTimeConstant = 0.6;
      // The default −100…−30 dB window saturates with loud music; this keeps headroom.
      this.analyserNode.minDecibels = -90;
      this.analyserNode.maxDecibels = -18;
      source.connect(this.analyserNode);
      this.analyserNode.connect(this.context.destination);
    } catch {
      this.context = null;
      this.analyserNode = null;
    }
  }

  private releaseUrl(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}
