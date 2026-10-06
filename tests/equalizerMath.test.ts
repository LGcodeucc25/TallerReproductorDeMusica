import { describe, expect, it } from 'vitest';
import {
  columnColor,
  hashString,
  logBinRanges,
  PEAK_FALL_PER_S,
  PEAK_HOLD_MS,
  proceduralLevels,
  spectrumToLevels,
  stepLevel,
  stepPeak,
} from '../src/ui/equalizerMath';

describe('log-scale bin mapping', () => {
  // fftSize 2048 at 48 kHz: 1024 bins of 23.4375 Hz.
  const ranges = logBinRanges(64, 1024, 48_000);
  const hzPerBin = 24_000 / 1024;

  it('covers 40 Hz to 16 kHz with contiguous, non-empty ranges', () => {
    expect(ranges).toHaveLength(64);
    expect(ranges[0].from).toBe(Math.floor(40 / hzPerBin));
    expect(ranges[63].to).toBe(Math.ceil(16_000 / hzPerBin));
    for (let i = 0; i < ranges.length; i++) {
      expect(ranges[i].to).toBeGreaterThan(ranges[i].from);
      if (i > 0) expect(ranges[i].from).toBe(ranges[i - 1].to);
    }
  });

  it('gives bass and mids many more columns than a linear scale would', () => {
    // On a linear scale, everything below 1 kHz would fit in about 3 of 64 columns.
    const belowOneKhz = ranges.filter((range) => range.to * hzPerBin <= 1000).length;
    expect(belowOneKhz).toBeGreaterThan(25);
    // High columns cover many bins each.
    expect(ranges[63].to - ranges[63].from).toBeGreaterThan(20);
  });

  it('stays inside the available bins at low sample rates', () => {
    const narrow = logBinRanges(40, 1024, 22_050);
    expect(narrow.every((range) => range.to <= 1024 && range.from >= 0)).toBe(true);
  });

  it('turns byte data into 0–1 levels, boosting the high columns a little', () => {
    const data = new Uint8Array(8).fill(128);
    const levels = spectrumToLevels(data, [{ from: 0, to: 4 }, { from: 4, to: 8 }], 0.5);
    expect(levels[0]).toBeCloseTo(128 / 255);
    expect(levels[1]).toBeCloseTo((128 / 255) * 1.5);
    expect(spectrumToLevels(new Uint8Array(4).fill(255), [{ from: 0, to: 4 }], 0.5)).toEqual([1]);
  });
});

describe('attack, release and peak hold', () => {
  it('rises fast and falls slowly', () => {
    const up = stepLevel(0, 1, 16);
    const down = 1 - stepLevel(1, 0, 16);
    expect(up).toBeGreaterThan(0.3);
    expect(down).toBeLessThan(0.1);
    expect(up).toBeGreaterThan(down * 4);
    expect(stepLevel(0.5, 0.5, 16)).toBe(0.5);
    expect(stepLevel(0, 1, 10_000)).toBeCloseTo(1);
  });

  it('holds the peak, then lets it fall, never below the level', () => {
    let peak = stepPeak({ value: 0, holdMs: 0 }, 0.8, 16);
    expect(peak).toEqual({ value: 0.8, holdMs: PEAK_HOLD_MS });
    peak = stepPeak(peak, 0.2, PEAK_HOLD_MS - 10);
    expect(peak.value).toBe(0.8);
    peak = stepPeak(peak, 0.2, 10);
    expect(peak).toEqual({ value: 0.8, holdMs: 0 });
    peak = stepPeak(peak, 0.2, 100);
    expect(peak.value).toBeCloseTo(0.8 - PEAK_FALL_PER_S * 0.1);
    peak = stepPeak(peak, 0.2, 5000);
    expect(peak.value).toBe(0.2);
  });
});

describe('procedural spectrum (Spotify songs)', () => {
  it('is deterministic for a seed and different between songs', () => {
    expect(proceduralLevels('4uLU6hMCjMI75M1A2tKUQC', 12_345, 64)).toEqual(proceduralLevels('4uLU6hMCjMI75M1A2tKUQC', 12_345, 64));
    expect(proceduralLevels('trackA', 12_345, 64)).not.toEqual(proceduralLevels('trackB', 12_345, 64));
    expect(hashString('abc')).toBe(hashString('abc'));
  });

  it('always stays within 0..1', () => {
    for (let t = 0; t < 120_000; t += 137) {
      for (const level of proceduralLevels('seed', t, 40)) {
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(1);
      }
    }
  });

  it('moves smoothly between frames and never repeats a window of time', () => {
    const a = proceduralLevels('seed', 5000, 64);
    const b = proceduralLevels('seed', 5016, 64);
    const maxStep = Math.max(...a.map((level, i) => Math.abs(level - b[i])));
    expect(maxStep).toBeLessThan(0.35); // hits may jump a bit; the motion itself is smooth
    const window = (start: number) => Array.from({ length: 20 }, (_, k) => proceduralLevels('seed', start + k * 50, 16).join());
    expect(window(10_000)).not.toEqual(window(70_000));
  });

  it('moves bass more and slower than highs', () => {
    const columns = 64;
    const samples = Array.from({ length: 600 }, (_, k) => proceduralLevels('seed', k * 33, columns));
    const spread = (column: number) => {
      const values = samples.map((levels) => levels[column]);
      return Math.max(...values) - Math.min(...values);
    };
    const meanStep = (column: number) =>
      samples.slice(1).reduce((sum, levels, k) => sum + Math.abs(levels[column] - samples[k][column]), 0) / (samples.length - 1);
    expect(spread(2)).toBeGreaterThan(spread(60));
    // Relative to their range, highs change faster frame to frame.
    expect(meanStep(60) / spread(60)).toBeGreaterThan(meanStep(2) / spread(2));
  });
});

describe('column colours', () => {
  it('go from lagoon on the left to tomato on the right', () => {
    expect(columnColor(0, 64)).toBe('rgb(46, 154, 165)');
    expect(columnColor(63, 64)).toBe('rgb(219, 58, 31)');
    expect(columnColor(0, 1)).toBe('rgb(46, 154, 165)');
  });
});
