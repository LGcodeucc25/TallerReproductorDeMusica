/**
 * Client for LRCLIB (https://lrclib.net), a free lyrics database with no API key.
 * It sends `Access-Control-Allow-Origin: *`, so the browser calls it directly.
 */

const API_BASE = 'https://lrclib.net/api';
/** A search result must be within this many seconds of the song's duration. */
export const DURATION_TOLERANCE_S = 3;
const TIMEOUT_MS = 10_000;

export interface LrclibRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  /** Seconds. */
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export type LyricsContent =
  | { kind: 'synced'; lrc: string }
  | { kind: 'plain'; text: string }
  | { kind: 'instrumental' }
  | { kind: 'not-found' };

export interface LyricsQuery {
  title: string;
  artist: string;
  album: string;
  /** Seconds (0 when unknown). */
  durationSec: number;
}

export class LyricsFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LyricsFetchError';
  }
}

/**
 * Best search result: only results within ±DURATION_TOLERANCE_S of the duration
 * (any result when the duration is unknown); among them, synced lyrics first, then
 * the closest duration. Returns null when nothing fits.
 */
export function pickBestMatch(records: readonly LrclibRecord[], durationSec: number): LrclibRecord | null {
  const distance = (record: LrclibRecord) => (durationSec > 0 ? Math.abs(record.duration - durationSec) : 0);
  const candidates = records.filter((record) => durationSec <= 0 || distance(record) <= DURATION_TOLERANCE_S);
  const usable = candidates.filter((record) => record.syncedLyrics || record.plainLyrics || record.instrumental);
  const ranked = [...usable].sort(
    (a, b) => Number(!a.syncedLyrics) - Number(!b.syncedLyrics) || distance(a) - distance(b),
  );
  return ranked[0] ?? null;
}

/** What to show for a record: instrumental wins, then synced lyrics, then plain lyrics. */
export function contentFromRecord(record: LrclibRecord | null): LyricsContent {
  if (!record) return { kind: 'not-found' };
  if (record.instrumental) return { kind: 'instrumental' };
  if (record.syncedLyrics?.trim()) return { kind: 'synced', lrc: record.syncedLyrics };
  if (record.plainLyrics?.trim()) return { kind: 'plain', text: record.plainLyrics };
  return { kind: 'not-found' };
}

export class LrclibClient {
  constructor(private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init)) {}

  /** /api/get first (exact match); if it is 404, /api/search and pick the closest result. */
  async find(query: LyricsQuery): Promise<LyricsContent> {
    const durationSec = Math.round(query.durationSec);
    if (query.album && durationSec > 0) {
      const exact = await this.request<LrclibRecord>('/get', {
        track_name: query.title,
        artist_name: query.artist,
        album_name: query.album,
        duration: String(durationSec),
      });
      if (exact) {
        const content = contentFromRecord(exact);
        if (content.kind !== 'not-found') return content;
      }
    }
    const results = await this.request<LrclibRecord[]>('/search', { track_name: query.title, artist_name: query.artist });
    return contentFromRecord(pickBestMatch(results ?? [], durationSec));
  }

  /** null on 404; throws LyricsFetchError when offline, on timeout or on other errors. */
  private async request<T>(path: string, params: Record<string, string>): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchFn(`${API_BASE}${path}?${new URLSearchParams(params)}`, { signal: controller.signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new LyricsFetchError(`LRCLIB answered ${response.status}.`);
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof LyricsFetchError) throw error;
      throw new LyricsFetchError(controller.signal.aborted ? 'LRCLIB did not answer in time.' : 'Could not reach LRCLIB.');
    } finally {
      clearTimeout(timer);
    }
  }
}
