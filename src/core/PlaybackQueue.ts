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

  constructor(private readonly random: () => number = Math.random) {}

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
    this.emit();
  }

  /** Restores a saved queue as it was (order, current song and shuffle flag). */
  restore(source: Playlist | null, songs: readonly Song[], currentId: string | null, shuffle: boolean): void {
    this.songs.clear();
    for (const song of songs) this.songs.append(song);
    this.source = source?.id ?? null;
    this.sourceOrder = source?.order() ?? [];
    this.shuffled = shuffle;
    this.roundStart = null;
    this.currentNode = (currentId && this.findNode(currentId)) || this.songs.head;
    this.emit();
  }

  clear(): void {
    this.songs.clear();
    this.currentNode = null;
    this.roundStart = null;
    this.sourceOrder = [];
    this.emit();
  }

  // ---- Navigation ----

  /**
   * Moves to the next song. With `auto` (the song ended) and repeat 'one', the
   * current song is returned again. With repeat 'all' the tail wraps to the head;
   * in shuffle mode the wrap reshuffles the queue for the new round.
   * Returns null when there is no next song.
   */
  next(repeat: RepeatMode = 'off', auto = false): Song | null {
    const node = this.currentNode;
    if (!node) return null;
    if (auto && repeat === 'one') return node.value;

    let target = node.next;
    if (!target) {
      if (repeat !== 'all') return null;
      target = this.shuffled ? this.reshuffleForNewRound() : this.songs.head;
    }
    this.currentNode = target;
    this.emit();
    return target!.value;
  }

  /** Moves to the previous song (tail when wrapping with repeat 'all'). Returns null when there is none. */
  previous(repeat: RepeatMode = 'off'): Song | null {
    const target = this.peekPreviousNode(repeat);
    if (!target) return null;
    this.currentNode = target;
    this.emit();
    return target.value;
  }

  hasNext(repeat: RepeatMode = 'off'): boolean {
    return !!this.currentNode && (!!this.currentNode.next || repeat === 'all');
  }

  /** The song that will play when the current one ends, or null if playback stops. */
  peekNext(repeat: RepeatMode = 'off'): Song | null {
    const node = this.currentNode;
    if (!node) return null;
    if (repeat === 'one') return node.value;
    return this.followingNode(node, repeat)?.value ?? null;
  }

  /** The song that "previous" would go to, or null if there is none. */
  peekPrevious(repeat: RepeatMode = 'off'): Song | null {
    return this.peekPreviousNode(repeat)?.value ?? null;
  }

  /**
   * The next `count` songs, never including the current one. With repeat 'all' it
   * continues after the wrap; in shuffle mode it stops at the first song of the next
   * round, because the rest of that round is reshuffled when it starts.
   */
  upcoming(count: number, repeat: RepeatMode = 'off'): Song[] {
    const result: Song[] = [];
    const start = this.currentNode;
    let node = start;
    while (node && result.length < count) {
      const wraps = !node.next;
      node = this.followingNode(node, repeat);
      if (!node || node === start) break;
      result.push(node.value);
      if (wraps && this.shuffled) break;
    }
    return result;
  }

  /** How many songs `upcoming` would return without a limit. */
  upcomingCount(repeat: RepeatMode = 'off'): number {
    if (!this.currentNode) return 0;
    let after = 0;
    for (let node = this.currentNode.next; node; node = node.next) after++;
    if (repeat !== 'all' || this.songs.length < 2) return after;
    return this.shuffled ? after + 1 : this.songs.length - 1;
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
    return { sourceId: this.source, order, currentId: this.current?.id ?? null, shuffle: this.shuffled };
  }

  // ---- Helpers ----

  private findNode(id: string): Node<Song> | null {
    return this.songs.findNode((song) => song.id === id);
  }

  /** The node after `node`, wrapping to the head (or to the next round's start) with repeat 'all'. */
  private followingNode(node: Node<Song>, repeat: RepeatMode): Node<Song> | null {
    if (node.next) return node.next;
    if (repeat !== 'all') return null;
    return this.shuffled ? this.nextRoundStart() : this.songs.head;
  }

  private peekPreviousNode(repeat: RepeatMode): Node<Song> | null {
    const node = this.currentNode;
    if (!node) return null;
    return node.prev ?? (repeat === 'all' ? this.songs.tail : null);
  }

  /** Picks (once) a random song other than the current one to open the next shuffled round. */
  private nextRoundStart(): Node<Song> | null {
    if (this.songs.length < 2) return this.songs.head;
    if (!this.roundStart || this.roundStart === this.currentNode) {
      const currentIndex = this.songs.indexOf(this.currentNode!);
      let pick = Math.floor(this.random() * (this.songs.length - 1));
      if (pick >= currentIndex) pick++;
      this.roundStart = this.songs.traverseToIndex(pick);
    }
    return this.roundStart;
  }

  /**
   * New shuffled round: Fisher–Yates over the links, then the chosen start song is
   * moved to the head. The song that just played can never open the round.
   */
  private reshuffleForNewRound(): Node<Song> | null {
    const start = this.nextRoundStart();
    this.songs.shuffle(this.random);
    if (start) this.songs.moveToFront(start);
    this.roundStart = null;
    return this.songs.head;
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
    this.songs.removeNode(node);
  }

  private signature(): string {
    return `${this.snapshot().order.join('|')}#${this.current?.id ?? ''}`;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
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
