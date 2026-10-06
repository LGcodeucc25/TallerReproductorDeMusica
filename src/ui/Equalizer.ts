import { prefersReducedMotion } from './dom';
import {
  clamp01,
  columnColor,
  logBinRanges,
  proceduralLevels,
  spectrumToLevels,
  stepLevel,
  stepPeak,
  type BinRange,
  type Peak,
} from './equalizerMath';

/**
 * Segmented LED equalizer on a canvas. Every frame is computed in JavaScript from
 * one source: the Web Audio analyser for local songs (real data), or a procedural
 * generator seeded with the track id for Spotify songs (their audio is DRM-protected).
 * Paused, the columns decay to rest and the loop stops.
 */

/** Unlit segments: never tinted with the column colour. */
export const UNLIT = 'rgba(244, 233, 216, 0.06)';
/** About 15 fps when the user prefers reduced motion. */
const REDUCED_FRAME_MS = 66;

export interface EqualizerSource {
  /** Is something playing right now? */
  playing(): boolean;
  /** The analyser of the local engine, when the current song is a local file. */
  analyser(): AnalyserNode | null;
  /** Seed of the procedural motion (the Spotify track id), when there is no analyser. */
  proceduralSeed(): string | null;
}

export interface EqualizerOptions {
  /** Number of columns (a function, so it can follow the screen width). */
  columns: () => number;
  segment: number;
  segmentGap: number;
  columnGap: number;
}

/** How many segments fit in `height` px. */
export function segmentCount(height: number, segment: number, gap: number): number {
  return Math.max(1, Math.floor((height + gap) / (segment + gap)));
}

export class Equalizer {
  private readonly context: CanvasRenderingContext2D;
  private levels: number[] = [];
  private peaks: Peak[] = [];
  private colors: string[] = [];
  private data: Uint8Array<ArrayBuffer> | null = null;
  /** Bin ranges cached per analyser and column count. */
  private ranges: { key: string; value: BinRange[] } | null = null;
  private frame = 0;
  private lastFrame = 0;
  private width = 0;
  private height = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly source: EqualizerSource,
    private readonly options: EqualizerOptions,
  ) {
    this.context = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /** Starts the loop (on play, pause or song change); it stops by itself at rest. */
  wake(): void {
    if (!this.frame) {
      this.lastFrame = 0;
      this.frame = requestAnimationFrame(this.loop);
    }
  }

  private resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.width = width;
    this.height = height;
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.draw();
  }

  private readonly loop = (time: number): void => {
    this.frame = 0;
    const reduced = prefersReducedMotion();
    const elapsed = this.lastFrame ? time - this.lastFrame : 16;
    if (reduced && this.lastFrame && elapsed < REDUCED_FRAME_MS) {
      this.frame = requestAnimationFrame(this.loop);
      return;
    }
    this.lastFrame = time;
    const playing = this.source.playing();
    this.update(playing, time, Math.min(elapsed, 100), reduced);
    this.draw(reduced);
    const resting = !playing && this.levels.every((level) => level < 0.004) && this.peaks.every((peak) => peak.value < 0.004);
    if (!resting) this.frame = requestAnimationFrame(this.loop);
  };

  private update(playing: boolean, time: number, elapsed: number, reduced: boolean): void {
    const count = this.options.columns();
    if (this.levels.length !== count) {
      this.levels = new Array(count).fill(0);
      this.peaks = Array.from({ length: count }, () => ({ value: 0, holdMs: 0 }));
      this.colors = Array.from({ length: count }, (_, i) => columnColor(i, count));
    }
    const targets = playing ? this.targets(count, time) : null;
    for (let i = 0; i < count; i++) {
      this.levels[i] = stepLevel(this.levels[i], targets?.[i] ?? 0, elapsed);
      this.peaks[i] = reduced ? { value: 0, holdMs: 0 } : stepPeak(this.peaks[i], this.levels[i], elapsed);
    }
  }

  /** This frame's target levels: real spectrum, procedural motion, or rest. */
  private targets(count: number, time: number): number[] | null {
    const analyser = this.source.analyser();
    if (analyser) {
      if (this.data?.length !== analyser.frequencyBinCount) this.data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(this.data);
      const key = `${analyser.frequencyBinCount}|${analyser.context.sampleRate}|${count}`;
      if (this.ranges?.key !== key) {
        this.ranges = { key, value: logBinRanges(count, analyser.frequencyBinCount, analyser.context.sampleRate) };
      }
      return spectrumToLevels(this.data, this.ranges.value);
    }
    const seed = this.source.proceduralSeed();
    // Wall-clock time, not the song position: seeking or changing songs continues smoothly.
    return seed ? proceduralLevels(seed, time, count) : null;
  }

  private draw(reduced = prefersReducedMotion()): void {
    const { width, height } = this;
    const ctx = this.context;
    ctx.clearRect(0, 0, width, height);
    if (width === 0 || height === 0) return;
    const count = this.options.columns();
    const { segment, segmentGap, columnGap } = this.options;
    const segments = segmentCount(height, segment, segmentGap);
    const columnWidth = Math.max(1, (width - columnGap * (count - 1)) / count);
    const step = segment + segmentGap;

    for (let i = 0; i < count; i++) {
      const x = i * (columnWidth + columnGap);
      const lit = Math.round(clamp01(this.levels[i] ?? 0) * segments);
      const peak = reduced ? 0 : Math.round(clamp01(this.peaks[i]?.value ?? 0) * segments);
      const color = this.colors[i] ?? columnColor(i, count);
      for (let s = 0; s < segments; s++) {
        const y = height - s * step - segment;
        // The peak marker: one lit segment that holds above the column, then falls.
        const isPeak = peak > lit && s === peak - 1;
        ctx.fillStyle = s < lit || isPeak ? color : UNLIT;
        ctx.fillRect(x, y, columnWidth, segment);
      }
    }
  }
}
