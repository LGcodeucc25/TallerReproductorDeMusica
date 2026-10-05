import type { QueueSnapshot } from '../core/PlaybackQueue';
import type { PlaylistSnapshot, RepeatMode } from '../core/Playlist';
import type { Song } from '../core/Song';

export type DockMode = 'mini' | 'panel';

/** Saved queue. `order: null` means "rebuild it from the source playlist" (migrated states). */
export type SavedQueue = Omit<QueueSnapshot, 'order'> & { order: string[] | null };

export interface PersistedState {
  version: 4;
  /** Every playlist in library order; the first one holds every song. */
  playlists: PlaylistSnapshot[];
  viewedId: string;
  repeat: RepeatMode;
  volume: number;
  /** Playback position of the current song, in seconds. */
  position: number;
  dock: DockMode;
  stageWidth: number;
  /** The playback queue, independent from the playlists. */
  queue: SavedQueue | null;
}

/** Version 3: playlists had a current song and shuffle reordered the active playlist itself. */
interface StateV3 {
  version: 3;
  playlists: (PlaylistSnapshot & { currentId?: string | null })[];
  activeId: string;
  viewedId: string;
  repeat: RepeatMode;
  volume: number;
  position: number;
  dock: DockMode;
  stageWidth: number;
  shuffle: boolean;
  /** The shuffled playlist and its order before shuffling. */
  shuffled: { playlistId: string; order: string[] } | null;
}

/** Version 2: like version 3 without shuffle mode. */
type StateV2 = Omit<StateV3, 'version' | 'shuffle' | 'shuffled'> & { version: 2 };

/** State saved by the first version (a single playlist). */
interface LegacyState {
  order: string[];
  currentId: string | null;
  repeat: RepeatMode;
  volume: number;
  position: number;
}

const DB_NAME = 'doubly-linked-music-player';
/** Database used before the rename; copied once into DB_NAME and then deleted. */
const LEGACY_DB_NAME = 'reproductor-listas-dobles';
const DB_VERSION = 1;
const SONGS = 'songs';
const META = 'meta';
const STATE_KEY = 'playlist-state';
const LEGACY_COPIED_KEY = 'legacy-db-copied';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves the imported files, the playlists and the queue in the browser (IndexedDB),
 * so each user keeps their own music between visits. Nothing is uploaded.
 */
export class SongStore {
  private db: Promise<IDBDatabase> | null = null;

  async putSong(song: Song): Promise<void> {
    await this.write([SONGS], (tx) => tx.objectStore(SONGS).put(song));
  }

  async deleteSong(id: string): Promise<void> {
    await this.write([SONGS], (tx) => tx.objectStore(SONGS).delete(id));
  }

  async getSongs(): Promise<Map<string, Song>> {
    const db = await this.open();
    const songs = await promisify<Song[]>(db.transaction(SONGS, 'readonly').objectStore(SONGS).getAll());
    return new Map(songs.map((song) => [song.id, song]));
  }

  async saveState(state: PersistedState): Promise<void> {
    await this.write([META], (tx) => tx.objectStore(META).put(state, STATE_KEY));
  }

  async loadState(): Promise<PersistedState | null> {
    const db = await this.open();
    const state = await promisify<PersistedState | StateV3 | StateV2 | LegacyState | undefined>(
      db.transaction(META, 'readonly').objectStore(META).get(STATE_KEY),
    );
    return state ? migrateState(state) : null;
  }

  async clearSongs(): Promise<void> {
    await this.write([SONGS], (tx) => tx.objectStore(SONGS).clear());
  }

  async clearAll(): Promise<void> {
    await this.write([SONGS, META], (tx) => {
      tx.objectStore(SONGS).clear();
      tx.objectStore(META).clear();
    });
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= this.openDatabase();
    return this.db;
  }

  private async openDatabase(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available in this browser.');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const upgrading = request.result;
        if (!upgrading.objectStoreNames.contains(SONGS)) upgrading.createObjectStore(SONGS, { keyPath: 'id' });
        if (!upgrading.objectStoreNames.contains(META)) upgrading.createObjectStore(META);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await this.copyLegacyDatabase(db);
    return db;
  }

  /**
   * One-time migration of the database used before the rename: its songs and
   * state are copied into the new database, then the old one is deleted. A marker
   * is written only after the copy succeeds, so a failed attempt is retried.
   */
  private async copyLegacyDatabase(db: IDBDatabase): Promise<void> {
    const copied = await promisify(db.transaction(META, 'readonly').objectStore(META).get(LEGACY_COPIED_KEY));
    if (copied) return;

    const legacy = await openExisting(LEGACY_DB_NAME);
    if (legacy) {
      const stores = legacy.objectStoreNames;
      const songs = stores.contains(SONGS)
        ? await promisify<Song[]>(legacy.transaction(SONGS, 'readonly').objectStore(SONGS).getAll())
        : [];
      const state = stores.contains(META)
        ? await promisify<unknown>(legacy.transaction(META, 'readonly').objectStore(META).get(STATE_KEY))
        : undefined;
      legacy.close();

      await this.writeTo(db, [SONGS, META], (tx) => {
        for (const song of songs) tx.objectStore(SONGS).put(song);
        if (state !== undefined) tx.objectStore(META).put(state, STATE_KEY);
      });
      await deleteDatabase(LEGACY_DB_NAME);
    }
    await this.writeTo(db, [META], (tx) => tx.objectStore(META).put(true, LEGACY_COPIED_KEY));
  }

  /** Runs a write and waits for the transaction to commit (quota errors surface here). */
  private async write(stores: string[], work: (tx: IDBTransaction) => void): Promise<void> {
    await this.writeTo(await this.open(), stores, work);
  }

  private writeTo(db: IDBDatabase, stores: string[], work: (tx: IDBTransaction) => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      work(tx);
    });
  }
}

/** Opens a database only if it already exists (never creates it). */
function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = (event) => {
      // Version 0 means it did not exist: abort so it is not created.
      if (event.oldVersion === 0) request.transaction?.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => {
      event.preventDefault();
      resolve(null);
    };
  });
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    // Another tab still has it open: it will be deleted when that tab closes.
    request.onblocked = () => resolve();
  });
}

/** Brings any saved state up to the current version. */
export function migrateState(state: PersistedState | StateV3 | StateV2 | LegacyState): PersistedState {
  if ('version' in state && state.version === 4) return state;
  if ('version' in state && state.version === 3) return fromV3(state);
  // Older states start with "repeat the playlist" on, the default since version 3.
  if ('version' in state && state.version === 2) return fromV3({ ...state, version: 3, repeat: 'all', shuffle: false, shuffled: null });

  // The single-playlist format becomes the library playlist ("all").
  const legacy = state as LegacyState;
  return {
    version: 4,
    playlists: [{ id: 'all', name: '', order: legacy.order ?? [] }],
    viewedId: 'all',
    repeat: 'all',
    volume: legacy.volume ?? 0.8,
    position: legacy.position ?? 0,
    dock: 'panel',
    stageWidth: 360,
    queue: { sourceId: 'all', order: null, currentId: legacy.currentId ?? null, shuffle: false },
  };
}

/**
 * Version 3 shuffled the active playlist itself and kept its original order:
 * that order is put back into the playlist, and the queue is rebuilt from the
 * previously active playlist with its current song.
 */
function fromV3(state: StateV3): PersistedState {
  const playlists = state.playlists.map(({ id, name, order }) => {
    if (state.shuffled?.playlistId !== id) return { id, name, order };
    const present = new Set(order);
    const original = state.shuffled.order.filter((songId) => present.has(songId));
    const kept = new Set(original);
    return { id, name, order: [...original, ...order.filter((songId) => !kept.has(songId))] };
  });
  const active = state.playlists.find((playlist) => playlist.id === state.activeId);
  return {
    version: 4,
    playlists,
    viewedId: state.viewedId,
    repeat: state.repeat,
    volume: state.volume,
    position: state.position,
    dock: state.dock,
    stageWidth: state.stageWidth,
    queue: { sourceId: state.activeId, order: null, currentId: active?.currentId ?? null, shuffle: state.shuffle },
  };
}
