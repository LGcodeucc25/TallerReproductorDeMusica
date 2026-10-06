/**
 * Pure maths of the LED equalizer (no DOM): mapping FFT bins to columns on a
 * logarithmic scale, attack / release smoothing, peak hold, and the procedural
 * generator used for Spotify songs, whose DRM-protected audio cannot be analysed.
 */

export interface BinRange {
  /** First FFT bin of the column (inclusive). */
  from: number;
  /** Last FFT bin of the column (exclusive); always greater than `from`. */
  to: number;
}

/**
 * Splits [minHz, maxHz] into `columns` bands of equal width on a log scale and
 * returns the FFT bins of each band, so bass, mids and highs all get columns.
 * Narrow bass bands get at least one bin each.
 */
export function logBinRanges(
  columns: number,
  binCount: number,
  sampleRate: number,
  minHz = 40,
  maxHz = 16_000,
): BinRange[] {
  const hzPerBin = sampleRate / 2 / binCount;
  const top = Math.min(maxHz, sampleRate / 2);
  const ratio = top / minHz;
  const ranges: BinRange[] = [];
  let previousTo = 0;
  for (let i = 0; i < columns; i++) {
    const lowHz = minHz * ratio ** (i / columns);
    const highHz = minHz * ratio ** ((i + 1) / columns);
    let from = Math.max(previousTo === 0 ? Math.floor(lowHz / hzPerBin) : previousTo, 0);
    let to = Math.max(from + 1, Math.ceil(highHz / hzPerBin));
    if (to > binCount) to = binCount;
    if (from >= to) from = Math.max(0, to - 1);
    ranges.push({ from, to });
    previousTo = to;
  }
  return ranges;
}

/**
 * Column levels (0–1) from byte frequency data. Each column takes the loudest bin
 * of its band; higher columns get a little boost, because real music has much less
 * energy up there and the right side would otherwise look empty.
 */
export function spectrumToLevels(data: ArrayLike<number>, ranges: readonly BinRange[], highBoost = 0.5): number[] {
  const last = Math.max(1, ranges.length - 1);
  return ranges.map(({ from, to }, i) => {
    let peak = 0;
    for (let bin = from; bin < to; bin++) if (data[bin] > peak) peak = data[bin];
    const gain = 1 + highBoost * (i / last);
    return clamp01((peak / 255) * gain);
  });
}

export interface Envelope {
  /** Time constant when the level rises (fast). */
  attackMs: number;
  /** Time constant when the level falls (slower). */
  releaseMs: number;
}

export const DEFAULT_ENVELOPE: Envelope = { attackMs: 28, releaseMs: 240 };

/** Moves `level` towards `target`: quickly when rising, slowly when falling. */
export function stepLevel(level: number, target: number, elapsedMs: number, envelope: Envelope = DEFAULT_ENVELOPE): number {
  const constant = target > level ? envelope.attackMs : envelope.releaseMs;
  const amount = 1 - Math.exp(-Math.max(0, elapsedMs) / constant);
  return clamp01(level + (target - level) * amount);
}

export interface Peak {
  value: number;
  /** Milliseconds the peak still holds before it starts to fall. */
  holdMs: number;
}

export const PEAK_HOLD_MS = 420;
/** How fast a released peak falls, in levels per second. */
export const PEAK_FALL_PER_S = 0.9;

/** A small marker that jumps to each new maximum, holds briefly, then falls (never below the level). */
export function stepPeak(peak: Peak, level: number, elapsedMs: number): Peak {
  if (level >= peak.value) return { value: level, holdMs: PEAK_HOLD_MS };
  if (peak.holdMs > 0) return { value: peak.value, holdMs: Math.max(0, peak.holdMs - elapsedMs) };
  return { value: Math.max(level, peak.value - (PEAK_FALL_PER_S * elapsedMs) / 1000), holdMs: 0 };
}

// ---- Procedural spectrum (Spotify songs) ----

/** 32-bit FNV-1a hash of a string. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Hash of integers to [0, 1). */
function random01(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * 1D value noise: random values on an infinite integer lattice, smoothly
 * interpolated. It has no period, so the motion never visibly repeats.
 */
function valueNoise(seed: number, channel: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const smooth = f * f * (3 - 2 * f);
  const a = random01(seed, channel, i);
  const b = random01(seed, channel, i + 1);
  return a + (b - a) * smooth;
}

/** How long a "hit" lasts and how often one can happen. */
const HIT_SLOT_MS = 380;
const HIT_CHANCE = 0.16;
const HIT_DECAY_MS = 170;

/**
 * A believable but generic spectrum for songs whose audio cannot be read.
 * Seeded with the track id: each song moves differently, and the same song always
 * the same way at the same moment. Bass columns move more and slower, mids
 * moderately, highs less and faster, with occasional whole-spectrum hits.
 */
export function proceduralLevels(seedText: string, timeMs: number, columns: number): number[] {
  const seed = hashString(seedText);
  const t = timeMs / 1000;
  // Hits: time is cut into slots; some slots (chosen by the seed) start with a jump.
  const slot = Math.floor(timeMs / HIT_SLOT_MS);
  const sinceSlot = timeMs - slot * HIT_SLOT_MS;
  const hit = random01(seed, 7919, slot) < HIT_CHANCE ? Math.exp(-sinceSlot / HIT_DECAY_MS) : 0;
  // A slow shared "energy" so the whole spectrum breathes together like a mix.
  const energy = 0.75 + 0.5 * (valueNoise(seed, 104_729, t * 0.35) - 0.5);

  const raw = Array.from({ length: columns }, (_, column) => {
    const x = columns > 1 ? column / (columns - 1) : 0;
    const speed = 1.1 + 7 * x * x; // bass slow, highs fast
    const amplitude = 0.62 - 0.38 * x; // bass moves most
    const base = 0.42 - 0.22 * x; // highs sit lower
    const slow = valueNoise(seed, column, t * speed);
    const fast = valueNoise(seed, column + 1000, t * speed * 2.7);
    const motion = (slow * 0.7 + fast * 0.3 - 0.5) * 2 * amplitude;
    const hitShape = hit * (0.55 - 0.25 * x);
    return clamp01((base + motion) * energy + hitShape);
  });
  // Neighbouring columns blend a little, as neighbouring frequencies do.
  return raw.map((level, i) => clamp01(0.25 * (raw[i - 1] ?? level) + 0.5 * level + 0.25 * (raw[i + 1] ?? level)));
}

export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Colour stops of the columns, left to right: lagoon, mint, peach, orange, tomato. */
export const EQ_STOPS: readonly (readonly [number, number, number])[] = [
  [0x2e, 0x9a, 0xa5],
  [0x6c, 0xcf, 0xc6],
  [0xf5, 0xc5, 0x9a],
  [0xf5, 0x9a, 0x1e],
  [0xdb, 0x3a, 0x1f],
];

/** Colour of column `index` of `count`, interpolated along the stops. */
export function columnColor(index: number, count: number): string {
  const position = count > 1 ? (index / (count - 1)) * (EQ_STOPS.length - 1) : 0;
  const lower = Math.min(EQ_STOPS.length - 2, Math.floor(position));
  const f = position - lower;
  const [r, g, b] = EQ_STOPS[lower].map((channel, k) => Math.round(channel + (EQ_STOPS[lower + 1][k] - channel) * f));
  return `rgb(${r}, ${g}, ${b})`;
}
