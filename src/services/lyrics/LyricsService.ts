import type { Song } from '../../core/Song';
import { LrclibClient, type LyricsContent } from './lrclib';

export interface CachedLyrics {
  content: LyricsContent;
  fetchedAt: number;
}

/** Where cached lyrics persist (IndexedDB "lyrics" store, keyed by song id). */
export interface LyricsStore {
  getLyrics(songId: string): Promise<CachedLyrics | undefined>;
  putLyrics(songId: string, entry: CachedLyrics): Promise<void>;
}

/** "Not found" is remembered for a week, then asked again (LRCLIB keeps growing). */
export const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether a cached entry can still be used at `now`. */
export function isFresh(entry: CachedLyrics, now: number): boolean {
  return entry.content.kind !== 'not-found' || now - entry.fetchedAt < NOT_FOUND_TTL_MS;
}

/**
 * Lyrics for any song (local files use their ID3 data, Spotify songs their
 * metadata). Cached in memory and in IndexedDB, "not found" included, so a song
 * is not looked up again on every play. Network errors are never cached.
 */
export class LyricsService {
  private readonly memory = new Map<string, CachedLyrics>();
  private readonly pending = new Map<string, Promise<LyricsContent>>();

  constructor(
    private readonly store: LyricsStore | null,
    private readonly client = new LrclibClient(),
  ) {}

  get(song: Song): Promise<LyricsContent> {
    let request = this.pending.get(song.id);
    if (!request) {
      request = this.load(song).finally(() => this.pending.delete(song.id));
      this.pending.set(song.id, request);
    }
    return request;
  }

  private async load(song: Song): Promise<LyricsContent> {
    const now = Date.now();
    const inMemory = this.memory.get(song.id);
    if (inMemory && isFresh(inMemory, now)) return inMemory.content;

    const stored = await this.store?.getLyrics(song.id).catch(() => undefined);
    if (stored && isFresh(stored, now)) {
      this.memory.set(song.id, stored);
      return stored.content;
    }

    const content = await this.client.find({
      title: song.title,
      artist: song.artist,
      album: song.album,
      durationSec: song.duration,
    });
    const entry = { content, fetchedAt: Date.now() };
    this.memory.set(song.id, entry);
    void this.store?.putLyrics(song.id, entry).catch(() => undefined);
    return content;
  }
}
