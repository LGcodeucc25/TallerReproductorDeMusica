/**
 * Wraps the <audio> element and the Web Audio analyser used by the visualizer.
 * Songs are played from in-memory object URLs: files never leave the computer.
 */
export class AudioEngine {
  readonly element: HTMLAudioElement = new Audio();
  private objectUrl: string | null = null;
  private context: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;

  constructor() {
    this.element.preload = 'auto';
  }

  get paused(): boolean {
    return this.element.paused;
  }

  get hasSource(): boolean {
    return this.objectUrl !== null;
  }

  get currentTime(): number {
    return this.element.currentTime;
  }

  get duration(): number {
    const value = this.element.duration;
    return Number.isFinite(value) ? value : 0;
  }

  get volume(): number {
    return this.element.volume;
  }

  set volume(value: number) {
    this.element.volume = Math.min(1, Math.max(0, value));
    if (this.element.volume > 0) this.element.muted = false;
  }

  get muted(): boolean {
    return this.element.muted;
  }

  set muted(value: boolean) {
    this.element.muted = value;
  }

  get analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  load(file: Blob, startAt = 0): void {
    this.releaseUrl();
    this.objectUrl = URL.createObjectURL(file);
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

  /** The AudioContext must be created after a user gesture, so it is built lazily. */
  private ensureAnalyser(): void {
    if (this.context || typeof AudioContext === 'undefined') return;
    try {
      this.context = new AudioContext();
      const source = this.context.createMediaElementSource(this.element);
      this.analyserNode = this.context.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.78;
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
