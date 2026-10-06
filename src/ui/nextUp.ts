import type { RepeatMode } from '../core/Playlist';

/** What the queue says when it has no songs to list, or above them with repeat 'one'. */
export type QueueNote = 'repeatOne' | 'end' | 'empty';

export interface NextUpInput<T> {
  current: T | null;
  repeat: RepeatMode;
  /** The song that plays when the current one ends (`PlaybackQueue.peekNext`). */
  following: T | null;
  /** The upcoming songs (`PlaybackQueue.upcoming`), never including the current one. */
  upcoming: T[];
}

export interface NextUp<T> {
  /** Shown in the next-song card; null shows a dash. */
  next: T | null;
  /** Whether the next key is enabled: exactly when there is a next song to show. */
  canSkip: boolean;
  /** Songs listed in the queue. */
  items: T[];
  note: QueueNote | null;
}

/**
 * One rule for the next-song card, the queue list and the next key, by repeat mode:
 * 'one' repeats the current song, 'all' wraps (so the queue is never empty while
 * there are songs), and 'off' stops after the last song.
 */
export function nextUp<T>({ current, repeat, following, upcoming }: NextUpInput<T>): NextUp<T> {
  if (current === null) return { next: null, canSkip: false, items: [], note: 'empty' };
  // A single song with repeat 'all' wraps to itself.
  const items = upcoming.length === 0 && repeat === 'all' && following !== null ? [following] : upcoming;
  let note: QueueNote | null = null;
  if (repeat === 'one') note = 'repeatOne';
  else if (items.length === 0) note = 'end';
  return { next: following, canSkip: following !== null, items, note };
}
