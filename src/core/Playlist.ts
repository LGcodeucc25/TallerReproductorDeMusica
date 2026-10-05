import { DoublyLinkedList } from './DoublyLinkedList';
import type { Node } from './Node';
import type { Song } from './Song';

export type RepeatMode = 'off' | 'all' | 'one';

export type SortKey = 'title' | 'artist' | 'recent';

// Spanish collation for titles and artists: ignores accents and case, compares numbers inside titles.
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

const SORT_COMPARE: Record<SortKey, (a: Song, b: Song) => number> = {
  title: (a, b) => collator.compare(a.title, b.title),
  artist: (a, b) => collator.compare(a.artist, b.artist) || collator.compare(a.title, b.title),
  recent: (a, b) => b.addedAt - a.addedAt,
};

export interface PlaylistSnapshot {
  id: string;
  name: string;
  order: string[];
}

/**
 * A playlist is an ordered DoublyLinkedList<Song>. Its order only changes when
 * the user edits the playlist itself (add, remove, drag, sort, reverse).
 * Playback (current song, next, previous, shuffle) lives in PlaybackQueue.
 *
 * DOM-independent: the UI subscribes and only reflects this state.
 */
export class Playlist {
  readonly songs = new DoublyLinkedList<Song>();
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly id: string,
    private playlistName: string,
  ) {}

  get name(): string {
    return this.playlistName;
  }

  get size(): number {
    return this.songs.length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  rename(name: string): void {
    this.playlistName = name;
    this.emit();
  }

  has(songId: string): boolean {
    return this.songs.findNode((song) => song.id === songId) !== null;
  }

  // ---- Adding ----

  /** Adds one song at a slot (0 = before the first song, size = after the last one). */
  add(song: Song, at: number = this.songs.length): void {
    this.addMany([song], at);
  }

  /**
   * Adds several songs keeping their order, into the gap `at`:
   * slot 0 uses prepend, slot === size uses append and any other slot uses insert.
   */
  addMany(songs: readonly Song[], at: number = this.songs.length): void {
    if (songs.length === 0) return;
    const slot = Number.isFinite(at) ? Math.max(0, Math.min(Math.floor(at), this.songs.length)) : this.songs.length;

    if (slot === 0) {
      // Prepend in reverse so the given order is preserved.
      for (let i = songs.length - 1; i >= 0; i--) this.songs.prepend(songs[i]);
    } else if (slot === this.songs.length) {
      for (const song of songs) this.songs.append(song);
    } else {
      // One traversal to reach the gap, then each song is linked after the previous one in O(1).
      let last: Node<Song> = this.songs.insert(slot, songs[0]);
      for (let i = 1; i < songs.length; i++) last = this.songs.insertAfter(last, songs[i]);
    }
    this.emit();
  }

  // ---- Removing ----

  removeAt(index: number): Song | null {
    const removed = this.songs.remove(index);
    if (removed) this.emit();
    return removed;
  }

  removeById(id: string): Song | null {
    const node = this.songs.findNode((song) => song.id === id);
    if (!node) return null;
    const removed = this.songs.removeNode(node);
    this.emit();
    return removed;
  }

  clear(): void {
    this.songs.clear();
    this.emit();
  }

  // ---- Reordering (nodes are relinked, never recreated) ----

  move(fromIndex: number, toIndex: number): boolean {
    const moved = this.songs.move(fromIndex, toIndex);
    if (moved && fromIndex !== toIndex) this.emit();
    return moved;
  }

  reverse(): void {
    this.songs.reverse();
    this.emit();
  }

  /** Sorts the playlist physically with the stable merge sort. */
  sortBy(key: SortKey): void {
    this.songs.sort(SORT_COMPARE[key]);
    this.emit();
  }

  // ---- Info ----

  /** Ids in list order. */
  order(): string[] {
    const ids: string[] = [];
    for (const song of this.songs) ids.push(song.id);
    return ids;
  }

  totalDuration(): number {
    let total = 0;
    for (const song of this.songs) total += song.duration;
    return total;
  }

  /** Serializable form (ids in list order) for persistence. */
  snapshot(): PlaylistSnapshot {
    return { id: this.id, name: this.playlistName, order: this.order() };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
