import { DoublyLinkedList } from './DoublyLinkedList';
import { createId } from './id';
import { Playlist } from './Playlist';
import type { Song } from './Song';

export const ALL_SONGS_ID = 'all';
export const MAX_NAME_LENGTH = 60;

/** Display names are given by the UI layer, so the core holds no user-facing text. */
export interface LibraryNames {
  /** Name of the playlist that holds every song. */
  allSongs: string;
  /** Name suggested for the n-th new playlist. */
  newPlaylist(n: number): string;
}

const NEUTRAL_NAMES: LibraryNames = {
  allSongs: 'All songs',
  newPlaylist: (n) => `Playlist ${n}`,
};

/**
 * The library is itself a doubly linked list whose nodes are playlists:
 * a DoublyLinkedList<Playlist>, where each Playlist is a DoublyLinkedList<Song>.
 *
 * The all-songs playlist is always the head. A song can be in several playlists:
 * each playlist has its own node pointing to the same Song object, so the
 * audio file is stored only once.
 */
export class PlaylistLibrary {
  readonly playlists = new DoublyLinkedList<Playlist>();
  readonly allSongs: Playlist;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribers = new Map<string, () => void>();
  private batchDepth = 0;
  private pendingEmit = false;

  constructor(private readonly names: LibraryNames = NEUTRAL_NAMES) {
    this.allSongs = new Playlist(ALL_SONGS_ID, names.allSongs);
    this.attach(this.allSongs);
    this.playlists.append(this.allSongs);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Groups several changes into a single notification. */
  batch<T>(work: () => T): T {
    this.batchDepth++;
    try {
      return work();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.pendingEmit) {
        this.pendingEmit = false;
        this.emit();
      }
    }
  }

  get(id: string): Playlist | null {
    return this.playlists.findNode((playlist) => playlist.id === id)?.value ?? null;
  }

  /** User playlists (every node after the head). */
  *userPlaylists(): Generator<Playlist> {
    for (let node = this.playlists.head?.next ?? null; node; node = node.next) yield node.value;
  }

  get userCount(): number {
    return this.playlists.length - 1;
  }

  create(name: string, id: string = createId()): Playlist {
    const playlist = new Playlist(id, PlaylistLibrary.cleanName(name) || this.defaultName());
    this.attach(playlist);
    this.playlists.append(playlist);
    this.emit();
    return playlist;
  }

  remove(id: string): Playlist | null {
    if (id === ALL_SONGS_ID) return null;
    const node = this.playlists.findNode((playlist) => playlist.id === id);
    if (!node) return null;
    this.playlists.removeNode(node);
    this.unsubscribers.get(id)?.();
    this.unsubscribers.delete(id);
    this.emit();
    return node.value;
  }

  rename(id: string, name: string): boolean {
    const clean = PlaylistLibrary.cleanName(name);
    const playlist = this.get(id);
    if (!playlist || id === ALL_SONGS_ID || !clean) return false;
    playlist.rename(clean);
    return true;
  }

  /** Reorders user playlists. The head (the all-songs playlist) cannot move. */
  move(fromIndex: number, toIndex: number): boolean {
    if (fromIndex <= 0 || toIndex <= 0) return false;
    const moved = this.playlists.move(fromIndex, toIndex);
    if (moved && fromIndex !== toIndex) this.emit();
    return moved;
  }

  /**
   * New songs always enter the library. `slot` is the gap of the target playlist
   * where they go (0 = start, omitted or size = end, anything else = in between).
   * If the target is a user playlist, they also go at the end of the library.
   */
  importSongs(songs: readonly Song[], targetId: string, slot?: number): void {
    this.batch(() => {
      const target = this.get(targetId) ?? this.allSongs;
      if (target !== this.allSongs) this.allSongs.addMany(songs);
      target.addMany(songs, slot);
    });
  }

  /** Adds existing library songs at the end of a playlist, skipping the ones already there. */
  addToPlaylist(targetId: string, songs: readonly Song[]) {
    const target = this.get(targetId);
    if (!target || target === this.allSongs) return { added: 0, skipped: songs.length };
    const fresh = songs.filter((song) => !target.has(song.id));
    target.addMany(fresh);
    return { added: fresh.length, skipped: songs.length - fresh.length };
  }

  /** Deletes a song from the library and from every playlist that contains it. */
  removeSongEverywhere(songId: string): Song | null {
    return this.batch(() => {
      let removed: Song | null = null;
      for (const playlist of this.playlists) removed = playlist.removeById(songId) ?? removed;
      return removed;
    });
  }

  /** User playlists that contain the song. */
  containing(songId: string): Playlist[] {
    const result: Playlist[] = [];
    for (const playlist of this.userPlaylists()) if (playlist.has(songId)) result.push(playlist);
    return result;
  }

  clearLibrary(): void {
    this.batch(() => {
      for (const playlist of this.playlists) playlist.clear();
    });
  }

  defaultName(): string {
    const names = new Set<string>();
    for (const playlist of this.playlists) names.add(playlist.name);
    let n = this.userCount + 1;
    while (names.has(this.names.newPlaylist(n))) n++;
    return this.names.newPlaylist(n);
  }

  static cleanName(name: string): string {
    return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  }

  private attach(playlist: Playlist): void {
    this.unsubscribers.set(playlist.id, playlist.subscribe(() => this.emit()));
  }

  private emit(): void {
    if (this.batchDepth > 0) {
      this.pendingEmit = true;
      return;
    }
    for (const listener of this.listeners) listener();
  }
}
