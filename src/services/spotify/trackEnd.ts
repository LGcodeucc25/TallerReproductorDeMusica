/**
 * Deciding when a Spotify track we asked for has finished. The Web Playback SDK
 * has no "ended" event: the track either stops paused at position 0 right after
 * being near its end, or Spotify moves on to another track by itself (autoplay).
 * Pure functions, unit-tested.
 */

export interface TrackSnapshot {
  /** Uri of the track that is loaded (for relinked tracks, the uri we requested). */
  uri: string | null;
  paused: boolean;
  positionMs: number;
  durationMs: number;
}

/** 'ended': the track reached its end. 'switched': Spotify started another track on its own. */
export type TrackEnd = 'ended' | 'switched' | null;

/** Being this close to the end counts as "near the end". */
export const NEAR_END_MS = 3000;

/**
 * `previous` is the last known state of our track with its position estimated up
 * to now (interpolated), `next` is the state Spotify just reported.
 */
export function detectTrackEnd(expectedUri: string, previous: TrackSnapshot | null, next: TrackSnapshot): TrackEnd {
  if (!previous || previous.uri !== expectedUri) return null; // our track never started yet

  const wasNearEnd = previous.durationMs > 0 && previous.positionMs >= previous.durationMs - NEAR_END_MS;
  if (next.uri === null) return wasNearEnd ? 'ended' : null;
  if (next.uri !== expectedUri) return 'switched';

  if (next.paused && next.positionMs === 0 && wasNearEnd) return 'ended';
  // Some clients stop exactly at the end instead of going back to 0.
  if (next.paused && next.durationMs > 0 && next.positionMs >= next.durationMs - 500) return 'ended';
  return null;
}

/** Extra wait after the expected end before asking the player for its state. */
export const END_CHECK_GRACE_MS = 1500;

/**
 * Milliseconds until the end check should run for a playing track (its expected
 * end plus a grace period), or null when it is paused or its length is unknown.
 */
export function endCheckDelay(snapshot: TrackSnapshot, positionMs: number): number | null {
  if (snapshot.paused || snapshot.durationMs <= 0) return null;
  return Math.max(0, snapshot.durationMs - positionMs) + END_CHECK_GRACE_MS;
}

/** Position now, given a state reported `elapsedMs` ago (never beyond the end). */
export function interpolatePosition(snapshot: TrackSnapshot, elapsedMs: number): number {
  if (snapshot.paused) return snapshot.positionMs;
  const position = snapshot.positionMs + Math.max(0, elapsedMs);
  return snapshot.durationMs > 0 ? Math.min(position, snapshot.durationMs) : position;
}
