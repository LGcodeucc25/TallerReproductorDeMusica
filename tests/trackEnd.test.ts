import { describe, expect, it } from 'vitest';
import { detectTrackEnd, interpolatePosition, NEAR_END_MS, type TrackSnapshot } from '../src/services/spotify/trackEnd';

const URI = 'spotify:track:ours';
const state = (positionMs: number, paused = false, uri: string | null = URI): TrackSnapshot => ({
  uri,
  paused,
  positionMs,
  durationMs: 200_000,
});

describe('Spotify track end detection', () => {
  it('detects the end: paused at 0 right after being near the end', () => {
    expect(detectTrackEnd(URI, state(200_000 - NEAR_END_MS + 1), state(0, true))).toBe('ended');
  });

  it('detects the end when the player stops exactly at the end', () => {
    expect(detectTrackEnd(URI, state(150_000), state(199_800, true))).toBe('ended');
  });

  it('does not treat a pause or a seek to 0 in the middle as the end', () => {
    expect(detectTrackEnd(URI, state(60_000), state(60_000, true))).toBeNull();
    expect(detectTrackEnd(URI, state(60_000), state(0, true))).toBeNull();
    expect(detectTrackEnd(URI, state(60_000), state(0, false))).toBeNull();
  });

  it('detects Spotify switching to another track on its own (autoplay)', () => {
    expect(detectTrackEnd(URI, state(199_000), state(0, false, 'spotify:track:other'))).toBe('switched');
    expect(detectTrackEnd(URI, state(30_000), state(5_000, false, 'spotify:track:other'))).toBe('switched');
  });

  it('ignores states before our track started (previous track still reported)', () => {
    expect(detectTrackEnd(URI, null, state(0, true))).toBeNull();
    const old = state(10_000, false, 'spotify:track:previous');
    expect(detectTrackEnd(URI, old, state(0, true, 'spotify:track:previous'))).toBeNull();
  });

  it('treats an empty player after the end as ended, but not in the middle', () => {
    expect(detectTrackEnd(URI, state(199_500), state(0, true, null))).toBe('ended');
    expect(detectTrackEnd(URI, state(20_000), state(0, true, null))).toBeNull();
  });
});

describe('position interpolation', () => {
  it('moves while playing, stays while paused and never passes the end', () => {
    expect(interpolatePosition(state(10_000), 1500)).toBe(11_500);
    expect(interpolatePosition(state(10_000, true), 1500)).toBe(10_000);
    expect(interpolatePosition(state(199_000), 5000)).toBe(200_000);
    expect(interpolatePosition(state(10_000), -50)).toBe(10_000);
  });
});
