import { DoublyLinkedList } from './DoublyLinkedList';
import type { Node } from './Node';
import type { Playlist, RepeatMode } from './Playlist';
import type { Song } from './Song';

export interface QueueSnapshot {
  /** Playlist the queue was loaded from (null when nothing was loaded). */
  sourceId: string | null;
  /** Song ids in queue order. */
  order: string[];
  currentId: string | null;
  shuffle: boolean;
  /** Ids of the songs that continuous playback appended (missing in older saves). */
  continuous?: string[];
}

/**
 * The playback queue: a third doubly linked list, independent from the playlists.
 * Its nodes are new nodes that point to the same Song objects, so reordering or
 * shuffling the queue never touches the playlist it came from.
 *
 * It keeps a reference to the current node: next and previous follow `next` and
 * `prev` in O(1). With repeat 'all' it wraps from tail to head; in shuffle mode
 * each wrap starts a freshly shuffled round.
 *
 * With repeat 'off' the music does not have to stop at the tail: continuous
 * playback appends more songs (`extendForContinuousPlay`).
 *
 * DOM-independent: the UI subscribes and only reflects this state.
 */
export class PlaybackQueue {
  readonly songs = new DoublyLinkedList<Song>();
  private currentNode: Node<Song> | null = null;
  private source: string | null = null;
  private shuffled = false;
  /** Source playlist order at the last load or sync (songs added with playNext are not in it). */
  private sourceOrder: string[] = [];
  /** In shuffle mode, the song that opens the next round after a wrap (chosen ahead so the UI can show it). */
  private roundStart: Node<Song> | null = null;
  private readonly listeners = new Set<() => void>();
  /** Songs that cannot play right now (for example Spotify while disconnected) are skipped. */
  private isPlayable: (song: Song) => boolean = () => true;
  private skipped = 0;
  /** Songs appended by continuous playback (a song appears only once in the queue). */
  private readonly autoAdded = new Set<string>();

  constructor(private readonly random: () => number = Math.random) {}

  /** Sets which songs can play; navigation skips the others. Does not notify (the caller redraws). */
  setPlayable(isPlayable: (song: Song) => boolean): void {
    this.isPlayable = isPlayable;
    this.roundStart = null;
  }

  canPlay(song: Song): boolean {
    return this.isPlayable(song);
  }

  /** How many unplayable songs the last load, next or previous jumped over. */
  get lastSkipped(): number {
    return this.skipped;
  }

  get current(): Song | null {
    return this.currentNode?.value ?? null;
  }

  get sourceId(): string | null {
    return this.source;
  }

  get shuffle(): boolean {
    return this.shuffled;
  }

  get size(): number {
    return this.songs.length;
  }

  /** How many songs come after the current one in the list (no wrap). */
  get songsAfterCurrent(): number {
    let count = 0;
    for (let node = this.currentNode?.next ?? null; node; node = node.next) count++;
    return count;
  }

  /** Whether continuous playback appended this song. */
  isAutoAdded(song: Song): boolean {
    return this.autoAdded.has(song.id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- Loading ----

  /**
   * Rebuilds the queue from the playlist order, starting at `startSongId`
   * (or the first song). With shuffle on, the start song becomes the head and the
   * rest is shuffled by relinking nodes; without a start song everything is shuffled.
   */
  load(playlist: Playlist, startSongId: string | null = null, shuffle = this.shuffled): void {
    this.songs.clear();
    this.autoAdded.clear();
    for (const song of playlist.songs) this.songs.append(song);
    this.source = playlist.id;
    this.sourceOrder = playlist.order();
    this.shuffled = shuffle;
    this.roundStart = null;
    this.currentNode = (startSongId && this.findNode(startSongId)) || null;

    if (shuffle) {
      this.songs.shuffle(this.random);
      if (this.currentNode) this.songs.moveToFront(this.currentNode);
    }
    this.currentNode ??= this.songs.head;
    this.skipped = 0;
    if (this.currentNode && !this.isPlayable(this.currentNode.value)) {
      const found = this.scanForward(this.currentNode, 'all', false);
      if (found) {
        this.currentNode = found.node;
        this.skipped = found.skipped + 1;
      }
    }
    this.emit();
  }

  /** Restores a saved queue as it was (order, current song, shuffle flag and the songs continuous playback added). */
  restore(
    source: Playlist | null,
    songs: readonly Song[],
    currentId: string | null,
    shuffle: boolean,
    continuousIds: readonly string[] = [],
  ): void {
    this.songs.clear();
    this.autoAdded.clear();
    for (const song of songs) this.songs.append(song);
    const queued = new Set(songs.map((song) => song.id));
    for (const id of continuousIds) if (queued.has(id)) this.autoAdded.add(id);
    this.source = source?.id ?? null;
    this.sourceOrder = source?.order() ?? [];
    this.shuffled = shuffle;
    this.roundStart = null;
    this.currentNode = (currentId && this.findNode(currentId)) || this.songs.head;
    this.emit();
  }

  clear(): void {
    this.songs.clear();
    this.autoAdded.clear();
    this.currentNode = null;
    this.roundStart = null;
    this.sourceOrder = [];
    this.emit();
  }

  // ---- Navigation (unplayable songs are skipped) ----

  /**
   * Moves to the next playable song. With `auto` (the song ended) and repeat 'one',
   * the current song is returned again. With repeat 'all' the tail wraps to the head;
   * in shuffle mode the wrap reshuffles the queue for the new round.
   * Returns null when there is no next song.
   */
  next(repeat: RepeatMode = 'off', auto = false): Song | null {
    const node = this.currentNode;
    if (!node) return null;
    this.skipped = 0;
    if (auto && repeat === 'one' && this.isPlayable(node.value)) return node.value;

    const found = this.scanForward(node, repeat, this.shuffled);
    if (!found) return null;
    const target = found.wrapped && this.shuffled ? this.reshuffleForNewRound(found.node) : found.node;
    this.skipped = found.skipped;
    this.currentNode = target;
    this.emit();
    return target.value;
  }

  /** Moves to the previous playable song (tail when wrapping with repeat 'all'). Returns null when there is none. */
  previous(repeat: RepeatMode = 'off'): Song | null {
    const node = this.currentNode;
    if (!node) return null;
    const found = this.scanBackward(node, repeat);
    this.skipped = found?.skipped ?? 0;
    if (!found) return null;
    this.currentNode = found.node;
    this.emit();
    return found.node.value;
  }

  hasNext(repeat: RepeatMode = 'off'): boolean {
    return !!this.currentNode && this.scanForward(this.currentNode, repeat, this.shuffled) !== null;
  }

  /** The song that will play when the current one ends, or null if playback stops. */
  peekNext(repeat: RepeatMode = 'off'): Song | null {
    const node = this.currentNode;
    if (!node) return null;
    if (repeat === 'one' && this.isPlayable(node.value)) return node.value;
    return this.scanForward(node, repeat, this.shuffled)?.node.value ?? null;
  }

  /** The song that "previous" would go to, or null if there is none. */
  peekPrevious(repeat: RepeatMode = 'off'): Song | null {
    return this.currentNode ? (this.scanBackward(this.currentNode, repeat)?.node.value ?? null) : null;
  }

  /**
   * The next `count` playable songs, never including the current one. With repeat
   * 'all' it continues after the wrap; in shuffle mode it stops at the first song of
   * the next round, because the rest of that round is reshuffled when it starts.
   */
  upcoming(count: number, repeat: RepeatMode = 'off'): Song[] {
    const result: Song[] = [];
    const start = this.currentNode;
    let node = start;
    while (node && result.length < count) {
      if (node.next) {
        node = node.next;
      } else if (repeat !== 'all') {
        break;
      } else if (this.shuffled) {
        const first = this.nextRoundStart();
        if (first && first !== start) result.push(first.value);
        break;
      } else {
        node = this.songs.head!;
      }
      if (node === start) break;
      if (this.isPlayable(node.value)) result.push(node.value);
    }
    return result;
  }

  /** How many songs `upcoming` would return without a limit. */
  upcomingCount(repeat: RepeatMode = 'off'): number {
    return this.upcoming(Number.POSITIVE_INFINITY, repeat).length;
  }

  selectById(id: string): boolean {
    const node = this.findNode(id);
    if (!node) return false;
    this.currentNode = node;
    if (node === this.roundStart) this.roundStart = null;
    this.emit();
    return true;
  }

  // ---- Editing the queue (never the playlist) ----

  /**
   * Moves the node of `songId` right before or after the node of `refSongId`, O(1)
   * once both nodes are found. The current node never moves this way.
   */
  moveSong(songId: string, refSongId: string, where: 'before' | 'after'): boolean {
    const node = this.findNode(songId);
    const ref = this.findNode(refSongId);
    if (!node || !ref || node === ref || node === this.currentNode) return false;
    if ((where === 'before' ? ref.prev : ref.next) === node) return false;
    if (where === 'before') this.songs.moveBefore(node, ref);
    else this.songs.moveAfter(node, ref);
    this.emit();
    return true;
  }

  /**
   * "Play next": links the song right after the current node. If it is already in
   * the queue its node is moved instead of duplicating the song. With an empty
   * queue the song is appended and becomes the current one.
   */
  playNext(song: Song): void {
    const anchor = this.currentNode;
    const existing = this.findNode(song.id);
    if (!anchor) {
      if (!existing) this.currentNode = this.songs.append(song);
    } else if (existing) {
      if (existing === anchor) return;
      this.songs.moveAfter(existing, anchor);
    } else {
      this.songs.insertAfter(anchor, song);
    }
    if (this.roundStart === existing) this.roundStart = null;
    // Placed by hand: no longer one of the songs continuous playback added.
    this.autoAdded.delete(song.id);
    this.emit();
  }

  /** Removes a song from the queue (for example, deleted from the library). */
  removeById(id: string): boolean {
    const node = this.findNode(id);
    if (!node) return false;
    this.detach(node);
    this.emit();
    return true;
  }

  /**
   * "Re-shuffle": a new random order for every song after the current one, relinking
   * the existing nodes (Fisher–Yates over the links). The current song and every
   * song before it stay where they are, so playback and "previous" do not change.
   * Works with shuffle on or off and never changes the shuffle flag. Needs at least
   * two songs after the current one; returns whether the queue changed (one emit).
   */
  reshuffleUpcoming(random: () => number = this.random): boolean {
    const current = this.currentNode;
    if (!current || this.songsAfterCurrent < 2) return false;
    this.songs.shuffleAfter(current, random);
    this.emit();
    return true;
  }

  /**
   * Continuous playback: appends more songs at the tail (with `append`) so the music
   * goes on after the last one. First the library songs that are not in the queue,
   * shuffled; if every library song is already queued, a new shuffled round of the
   * source playlist (those songs leave their old place, since a song is queued only
   * once). Songs that cannot play are skipped. Returns the appended songs (one emit),
   * or an empty list when nothing playable is left to add.
   */
  extendForContinuousPlay(
    librarySongs: Iterable<Song>,
    sourceSongs: Iterable<Song>,
    isPlayable: (song: Song) => boolean = this.isPlayable,
    random: () => number = this.random,
  ): Song[] {
    const current = this.currentNode;
    if (!current) return [];
    const queued = new Set<string>();
    for (const song of this.songs) queued.add(song.id);

    let picks = uniqueById(librarySongs).filter((song) => !queued.has(song.id) && isPlayable(song));
    if (picks.length === 0) {
      // New round of the source: its songs are already queued, so their nodes move to the end.
      picks = uniqueById(sourceSongs).filter((song) => song.id !== current.value.id && queued.has(song.id) && isPlayable(song));
      for (const song of picks) this.songs.removeNode(this.findNode(song.id)!);
      this.roundStart = null;
    }
    if (picks.length === 0) return [];

    shuffleInPlace(picks, random);
    for (const song of picks) {
      this.songs.append(song);
      this.autoAdded.add(song.id);
    }
    this.emit();
    return picks;
  }

  /**
   * Shuffle on: everything except the current song is shuffled after it.
   * Shuffle off: the source playlist order comes back, with the current song kept
   * as current, so playback is not cut.
   */
  setShuffle(on: boolean, source: Playlist | null): void {
    this.shuffled = on;
    this.roundStart = null;
    if (on) {
      this.songs.shuffle(this.random);
      if (this.currentNode) this.songs.moveToFront(this.currentNode);
    } else if (source) {
      this.sortLike(source);
    }
    this.emit();
  }

  /**
   * Follows changes of the source playlist. Songs removed from it leave the queue;
   * new songs are appended, or inserted at a random place after the current song in
   * shuffle mode. If the playlist was reordered and shuffle is off, the queue order
   * is rebuilt from it (keeping the current song); otherwise manual changes to the
   * queue are kept. Returns whether the queue changed.
   */
  syncWith(playlist: Playlist): boolean {
    if (playlist.id !== this.source) return false;
    const before = this.signature();
    const order = playlist.order();
    const ids = new Set(order);
    const known = new Set(this.sourceOrder);

    for (const node of [...this.songs.nodes()]) {
      if (known.has(node.value.id) && !ids.has(node.value.id)) this.detach(node);
    }
    const inQueue = new Set([...this.songs].map((song) => song.id));
    for (const song of playlist.songs) {
      if (inQueue.has(song.id)) continue;
      if (this.shuffled) this.insertAtRandomAfterCurrent(song);
      else this.songs.append(song);
    }
    const reordered = !sameRelativeOrder(this.sourceOrder, order);
    this.sourceOrder = order;
    if (reordered && !this.shuffled) this.sortLike(playlist);
    this.currentNode ??= this.songs.head;

    const changed = this.signature() !== before;
    if (changed) this.emit();
    return changed;
  }

  snapshot(): QueueSnapshot {
    const order: string[] = [];
    for (const song of this.songs) order.push(song.id);
    return {
      sourceId: this.source,
      order,
      currentId: this.current?.id ?? null,
      shuffle: this.shuffled,
      continuous: order.filter((id) => this.autoAdded.has(id)),
    };
  }

  // ---- Helpers ----

  private findNode(id: string): Node<Song> | null {
    return this.songs.findNode((song) => song.id === id);
  }

  /**
   * Walks forward from `start` to the next playable node. Without repeat 'all' it
   * stops at the tail. With `shuffleWrap`, reaching the tail returns the chosen start
   * of the next shuffled round (flagged as `wrapped`) instead of the head.
   */
  private scanForward(
    start: Node<Song>,
    repeat: RepeatMode,
    shuffleWrap: boolean,
  ): { node: Node<Song>; wrapped: boolean; skipped: number } | null {
    let node = start;
    let wrapped = false;
    let skipped = 0;
    for (let steps = 0; steps < this.songs.length; steps++) {
      if (node.next) {
        node = node.next;
      } else if (repeat !== 'all') {
        return null;
      } else if (shuffleWrap) {
        const first = this.nextRoundStart();
        return first ? { node: first, wrapped: true, skipped } : null;
      } else {
        node = this.songs.head!;
        wrapped = true;
      }
      if (this.isPlayable(node.value)) return { node, wrapped, skipped };
      skipped++;
    }
    return null;
  }

  /** Walks backward from `start` to the previous playable node (wrapping to the tail with repeat 'all'). */
  private scanBackward(start: Node<Song>, repeat: RepeatMode): { node: Node<Song>; skipped: number } | null {
    let node = start;
    let skipped = 0;
    for (let steps = 0; steps < this.songs.length; steps++) {
      if (node.prev) node = node.prev;
      else if (repeat === 'all') node = this.songs.tail!;
      else return null;
      if (this.isPlayable(node.value)) return { node, skipped };
      skipped++;
    }
    return null;
  }

  /**
   * Picks (once) a random playable song other than the current one to open the next
   * shuffled round, so the song that just played never opens it.
   */
  private nextRoundStart(): Node<Song> | null {
    const current = this.currentNode;
    const valid = (node: Node<Song> | null) => !!node && node !== current && this.isPlayable(node.value);
    if (valid(this.roundStart)) return this.roundStart;
    const candidates = [...this.songs.nodes()].filter(valid);
    if (candidates.length === 0) return current && this.isPlayable(current.value) ? current : null;
    this.roundStart = candidates[Math.floor(this.random() * candidates.length)];
    return this.roundStart;
  }

  /** New shuffled round: Fisher–Yates over the links, then the chosen start song is moved to the head. */
  private reshuffleForNewRound(start: Node<Song>): Node<Song> {
    this.songs.shuffle(this.random);
    this.songs.moveToFront(start);
    this.roundStart = null;
    return start;
  }

  private insertAtRandomAfterCurrent(song: Song): void {
    if (!this.currentNode) {
      this.songs.append(song);
      return;
    }
    let after = 0;
    for (let node = this.currentNode.next; node; node = node.next) after++;
    let anchor = this.currentNode;
    for (let steps = Math.floor(this.random() * (after + 1)); steps > 0; steps--) anchor = anchor.next!;
    this.songs.insertAfter(anchor, song);
  }

  /**
   * Relinks the queue into the playlist order with the stable merge sort. Songs that
   * are not in the playlist (added with playNext) stay right after the song they follow.
   */
  private sortLike(playlist: Playlist): void {
    const position = new Map(playlist.order().map((id, index) => [id, index]));
    const rank = new Map<Song, number>(); // a song appears only once in the queue
    let last = -1;
    for (const song of this.songs) {
      const own = position.get(song.id);
      if (own !== undefined) last = own;
      rank.set(song, own ?? last + 0.5);
    }
    this.songs.sort((a, b) => rank.get(a)! - rank.get(b)!);
  }

  /** Unlinks a node; if it is the current one, the current reference moves to its neighbour first. */
  private detach(node: Node<Song>): void {
    if (node === this.currentNode) this.currentNode = node.next ?? node.prev;
    if (node === this.roundStart) this.roundStart = null;
    this.autoAdded.delete(node.value.id);
    this.songs.removeNode(node);
  }

  private signature(): string {
    return `${this.snapshot().order.join('|')}#${this.current?.id ?? ''}`;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** The songs in order, each id once. */
function uniqueById(songs: Iterable<Song>): Song[] {
  const seen = new Set<string>();
  const result: Song[] = [];
  for (const song of songs) {
    if (seen.has(song.id)) continue;
    seen.add(song.id);
    result.push(song);
  }
  return result;
}

/** Fisher–Yates on an array (the songs to append are not linked yet). */
function shuffleInPlace<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

/** Whether the songs present in both lists appear in the same relative order. */
function sameRelativeOrder(before: readonly string[], after: readonly string[]): boolean {
  const inAfter = new Set(after);
  const inBefore = new Set(before);
  const a = before.filter((id) => inAfter.has(id));
  const b = after.filter((id) => inBefore.has(id));
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
