import type { PlaybackQueue } from './PlaybackQueue';
import type { RepeatMode } from './Playlist';
import type { Song } from './Song';

/** Where continuous playback takes songs from: the whole library first, then the source playlist. */
export interface ContinuousSources {
  library: Iterable<Song>;
  source: Iterable<Song>;
}

/**
 * What to do when the current song ended: 'next' plays another song (the queue
 * already moved to it), 'replay' starts the same song again (repeat 'one', or a
 * single song wrapping), 'stop' means nothing playable is left.
 */
export type EndedOutcome = { kind: 'next'; song: Song } | { kind: 'replay'; song: Song } | { kind: 'stop' };

/**
 * Continuous playback ahead of time: with repeat 'off', when the current song is
 * the last playable one, more songs are appended now, so the next song is known
 * (and shown) before the current one ends. Returns whether songs were added.
 */
export function extendIfAtEnd(queue: PlaybackQueue, repeat: RepeatMode, sources: ContinuousSources): boolean {
  if (repeat !== 'off' || !queue.current || queue.hasNext('off')) return false;
  return queue.extendForContinuousPlay(sources.library, sources.source).length > 0;
}

/**
 * The "ended" flow for any engine: moves the queue with `next(repeat, auto = true)`.
 * Repeat 'one' replays, 'all' wraps (reshuffling the round in shuffle mode) and
 * 'off' continues with the songs continuous playback appends, so the music only
 * stops when nothing playable is left.
 */
export function advanceAfterEnd(
  queue: PlaybackQueue,
  repeat: RepeatMode,
  finishedId: string | null,
  sources: ContinuousSources,
): EndedOutcome {
  let song = queue.next(repeat, true);
  if (!song && extendIfAtEnd(queue, repeat, sources)) song = queue.next(repeat, true);
  if (!song) return { kind: 'stop' };
  return song.id === finishedId ? { kind: 'replay', song } : { kind: 'next', song };
}
