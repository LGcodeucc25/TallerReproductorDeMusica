import { expect } from 'vitest';
import type { DoublyLinkedList } from '../src/core/DoublyLinkedList';
import { spotifySongId, type LocalSong, type Song, type SpotifySong } from '../src/core/Song';

/** Minimal local song for tests: the id is the title. */
export const song = (title: string, extra: Partial<LocalSong> = {}): LocalSong => ({
  source: 'local',
  id: title,
  title,
  artist: 'Artist',
  album: '',
  duration: 180,
  fileName: `${title}.mp3`,
  file: new Blob(),
  cover: null,
  addedAt: 0,
  ...extra,
});

/** Minimal Spotify song for tests: the id is "spotify:<title>". */
export const spotifySong = (title: string, extra: Partial<SpotifySong> = {}): SpotifySong => ({
  source: 'spotify',
  id: spotifySongId(title),
  spotifyId: title,
  spotifyUri: `spotify:track:${title}`,
  title,
  artist: 'Artist',
  album: 'Album',
  duration: 200,
  coverUrl: null,
  externalUrl: `https://open.spotify.com/track/${title}`,
  addedAt: 0,
  ...extra,
});

/** Checks that every next/prev link is consistent in both directions; returns the values in order. */
export function expectConsistent<T>(list: DoublyLinkedList<T>): T[] {
  const forward: T[] = [];
  let previous = null;
  for (let node = list.head; node; node = node.next) {
    expect(node.prev).toBe(previous);
    forward.push(node.value);
    previous = node;
  }
  expect(previous).toBe(list.tail);
  expect(forward.length).toBe(list.length);

  const backward: T[] = [];
  for (let node = list.tail; node; node = node.prev) backward.push(node.value);
  expect(backward.reverse()).toEqual(forward);
  return forward;
}

/** Titles of a song list, checking its links on the way. */
export const titlesOf = (list: DoublyLinkedList<Song>): string[] => expectConsistent(list).map((value) => value.title);

/** Deterministic random numbers in [0, 1) (Park–Miller). */
export function seeded(seed: number): () => number {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
