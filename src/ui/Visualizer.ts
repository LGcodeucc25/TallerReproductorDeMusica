import type { AudioEngine } from '../services/AudioEngine';
import { prefersReducedMotion } from './dom';

const BARS = 48;

/** Frequency bars drawn on a canvas from the Web Audio analyser. */
export class Visualizer {
  private readonly context: CanvasRenderingContext2D;
  private readonly levels = new Float32Array(BARS);
  private data: Uint8Array<ArrayBuffer> | null = null;
  private frame = 0;
  private lastDraw = 0;
  private colors = { bar: '#E04FB4', peak: '#FF7A3D', idle: '#3B3880' };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly engine: AudioEngine) {
    this.context = canvas.getContext('2d')!;
    const styles = getComputedStyle(document.documentElement);
    this.colors = {
      bar: styles.getPropertyValue('--magenta').trim() || this.colors.bar,
      peak: styles.getPropertyValue('--orange').trim() || this.colors.peak,
      idle: styles.getPropertyValue('--line').trim() || this.colors.idle,
    };
    new ResizeObserver(() => this.resize()).observe(canvas);
    engine.element.addEventListener('play', () => this.start());
    this.resize();
  }

  private resize(): void {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.draw();
  }

  private start(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.loop);
  }

  private readonly loop = (time: number): void => {
    // With reduced motion the bars update a few times per second instead of every frame.
    const interval = prefersReducedMotion() ? 250 : 0;
    const playing = !this.engine.paused;

    if (time - this.lastDraw >= interval) {
      this.lastDraw = time;
      this.updateLevels(playing);
      this.draw();
    }

    const settled = !playing && this.levels.every((level) => level < 0.005);
    this.frame = settled ? 0 : requestAnimationFrame(this.loop);
    if (settled) this.draw();
  };

  private updateLevels(playing: boolean): void {
    const analyser = this.engine.analyser;
    if (analyser && playing) {
      this.data ??= new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(this.data);
    }
    // Use the lower ~70% of the spectrum, where music has most of its energy.
    const usable = this.data ? Math.floor(this.data.length * 0.7) : 0;
    for (let i = 0; i < BARS; i++) {
      let target = 0;
      if (playing && this.data && usable > 0) {
        const from = Math.floor((i / BARS) * usable);
        const to = Math.max(from + 1, Math.floor(((i + 1) / BARS) * usable));
        let sum = 0;
        for (let j = from; j < to; j++) sum += this.data[j];
        target = sum / (to - from) / 255;
      }
      const speed = target > this.levels[i] ? 0.55 : 0.12;
      this.levels[i] += (target - this.levels[i]) * speed;
    }
  }

  private draw(): void {
    const { width, height } = this.canvas.getBoundingClientRect();
    const ctx = this.context;
    ctx.clearRect(0, 0, width, height);
    const gap = 3;
    const barWidth = Math.max(1, (width - gap * (BARS - 1)) / BARS);

    for (let i = 0; i < BARS; i++) {
      const x = i * (barWidth + gap);
      const level = this.levels[i];
      if (level < 0.02) {
        ctx.fillStyle = this.colors.idle;
        ctx.fillRect(x, height - 3, barWidth, 3);
        continue;
      }
      const barHeight = Math.max(3, level * height);
      ctx.fillStyle = this.colors.bar;
      ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      ctx.fillStyle = this.colors.peak;
      ctx.fillRect(x, height - barHeight, barWidth, Math.min(3, barHeight));
    }
  }
}
