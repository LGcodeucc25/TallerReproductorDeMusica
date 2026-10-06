import { describe, expect, it } from 'vitest';
import { contentFromRecord, LrclibClient, pickBestMatch, type LrclibRecord } from '../src/services/lyrics/lrclib';
import { isFresh, LyricsService, NOT_FOUND_TTL_MS, type CachedLyrics } from '../src/services/lyrics/LyricsService';
import { song } from './helpers';

// Made-up data only: no real song lyrics in the tests.
const record = (id: number, duration: number, extra: Partial<LrclibRecord> = {}): LrclibRecord => ({
  id,
  trackName: 'Made Up',
  artistName: 'Nobody',
  albumName: 'Nothing',
  duration,
  instrumental: false,
  plainLyrics: 'plain words',
  syncedLyrics: null,
  ...extra,
});

describe('LRCLIB result selection', () => {
  it('prefers synced lyrics within ±3 s, then the closest duration', () => {
    const results = [
      record(1, 200, { syncedLyrics: null }),
      record(2, 202.5, { syncedLyrics: '[00:01.00]synced far' }),
      record(3, 201, { syncedLyrics: '[00:01.00]synced close' }),
      record(4, 230, { syncedLyrics: '[00:01.00]too long' }),
    ];
    expect(pickBestMatch(results, 200)?.id).toBe(3);
  });

  it('falls back to plain lyrics, and returns null when nothing fits the duration', () => {
    expect(pickBestMatch([record(1, 199), record(2, 260, { syncedLyrics: '[00:01.00]x' })], 200)?.id).toBe(1);
    expect(pickBestMatch([record(1, 100)], 200)).toBeNull();
    expect(pickBestMatch([], 200)).toBeNull();
  });

  it('ignores the duration when it is unknown', () => {
    expect(pickBestMatch([record(1, 100), record(2, 300, { syncedLyrics: '[00:01.00]x' })], 0)?.id).toBe(2);
  });

  it('turns a record into what to show: instrumental, synced, plain or not found', () => {
    expect(contentFromRecord(record(1, 1, { instrumental: true, syncedLyrics: '[00:01.00]x' }))).toEqual({ kind: 'instrumental' });
    expect(contentFromRecord(record(1, 1, { syncedLyrics: '[00:01.00]x' }))).toEqual({ kind: 'synced', lrc: '[00:01.00]x' });
    expect(contentFromRecord(record(1, 1))).toEqual({ kind: 'plain', text: 'plain words' });
    expect(contentFromRecord(record(1, 1, { plainLyrics: '  ' }))).toEqual({ kind: 'not-found' });
    expect(contentFromRecord(null)).toEqual({ kind: 'not-found' });
  });
});

describe('LRCLIB client (mocked fetch)', () => {
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it('uses /api/get first and /api/search when it is 404', async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/api/get')) return respond(404, { message: 'not found' });
      return respond(200, [record(1, 180, { syncedLyrics: '[00:02.00]found' })]);
    }) as typeof fetch;
    const content = await new LrclibClient(fetchFn).find({ title: 'Made Up', artist: 'Nobody', album: 'Nothing', durationSec: 180.4 });
    expect(content).toEqual({ kind: 'synced', lrc: '[00:02.00]found' });
    expect(calls[0]).toContain('/api/get?track_name=Made+Up&artist_name=Nobody&album_name=Nothing&duration=180');
    expect(calls[1]).toContain('/api/search?track_name=Made+Up&artist_name=Nobody');
  });

  it('reports network failures as errors (so they are not cached)', async () => {
    const failing = (async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    await expect(new LrclibClient(failing).find({ title: 'a', artist: 'b', album: '', durationSec: 0 })).rejects.toThrow(
      'Could not reach LRCLIB.',
    );
  });
});

describe('lyrics cache', () => {
  it('keeps "not found" for a week and found lyrics forever', () => {
    const notFound: CachedLyrics = { content: { kind: 'not-found' }, fetchedAt: 0 };
    expect(isFresh(notFound, NOT_FOUND_TTL_MS - 1)).toBe(true);
    expect(isFresh(notFound, NOT_FOUND_TTL_MS)).toBe(false);
    expect(isFresh({ content: { kind: 'plain', text: 'x' }, fetchedAt: 0 }, 10 * NOT_FOUND_TTL_MS)).toBe(true);
  });

  it('asks LRCLIB once per song, including when nothing was found', async () => {
    let requests = 0;
    const saved = new Map<string, CachedLyrics>();
    const store = {
      getLyrics: async (id: string) => saved.get(id),
      putLyrics: async (id: string, entry: CachedLyrics) => void saved.set(id, entry),
    };
    const fetchFn = (async () => {
      requests++;
      return new Response('[]', { status: 200 });
    }) as typeof fetch;
    const service = new LyricsService(store, new LrclibClient(fetchFn));
    const target = song('Quiet', { album: '', duration: 0 });

    expect(await service.get(target)).toEqual({ kind: 'not-found' });
    expect(await service.get(target)).toEqual({ kind: 'not-found' });
    expect(requests).toBe(1);
    expect(saved.get('Quiet')?.content).toEqual({ kind: 'not-found' });

    // A new session (empty memory) reads the stored entry instead of the network.
    await new LyricsService(store, new LrclibClient(fetchFn)).get(target);
    expect(requests).toBe(1);
  });
});
