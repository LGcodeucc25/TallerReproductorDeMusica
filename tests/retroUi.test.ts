import { describe, expect, it } from 'vitest';
import { spoolRadii, truncateLabel } from '../src/ui/Cassette';
import { splashHideDelay, splashTiming } from '../src/ui/splashTiming';

describe('cassette spools', () => {
  it('moves the tape from the left spool (24 → 12) to the right one (12 → 24)', () => {
    expect(spoolRadii(0)).toEqual({ left: 24, right: 12 });
    expect(spoolRadii(0.5)).toEqual({ left: 18, right: 18 });
    expect(spoolRadii(1)).toEqual({ left: 12, right: 24 });
  });

  it('clamps progress outside 0–1 and treats NaN as the start', () => {
    expect(spoolRadii(-1)).toEqual({ left: 24, right: 12 });
    expect(spoolRadii(3)).toEqual({ left: 12, right: 24 });
    expect(spoolRadii(Number.NaN)).toEqual({ left: 24, right: 12 });
  });

  it('truncates label text with an ellipsis', () => {
    expect(truncateLabel('Short', 10)).toBe('Short');
    expect(truncateLabel('A rather long song title', 10)).toBe('A rather…');
    expect(truncateLabel('  spaced   out  ', 20)).toBe('spaced out');
    expect(truncateLabel('A rather long song title', 10)).toHaveLength(9);
  });
});

describe('splash timing', () => {
  const normal = splashTiming(false);
  const reduced = splashTiming(true);

  it('lasts 1.6–4 s with a 300 ms fade, or 600 ms without motion and no fade', () => {
    expect(normal).toEqual({ minMs: 1600, maxMs: 4000, fadeMs: 300 });
    expect(reduced).toEqual({ minMs: 600, maxMs: 4000, fadeMs: 0 });
  });

  it('waits for the library, then for the minimum time', () => {
    expect(splashHideDelay(200, false, normal)).toBeNull();
    expect(splashHideDelay(500, true, normal)).toBe(1100);
    expect(splashHideDelay(2500, true, normal)).toBe(0);
    expect(splashHideDelay(300, true, reduced)).toBe(300);
  });

  it('never stays beyond the maximum, even if the library is still loading', () => {
    expect(splashHideDelay(4000, false, normal)).toBe(0);
    expect(splashHideDelay(9000, false, reduced)).toBe(0);
  });
});
