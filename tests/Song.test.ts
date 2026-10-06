import { describe, expect, it } from 'vitest';
import { PlaylistLibrary } from '../src/core/PlaylistLibrary';
import { migrateSong, spotifySongId } from '../src/core/Song';
import type { SpotifyTrack } from '../src/services/spotify/api';
import { songFromTrack } from '../src/services/spotify/mapping';
import { song, spotifySong, titlesOf } from './helpers';

const track = (id: string): SpotifyTrack => ({
  id,
  uri: `spotify:track:${id}`,
  name: `Track ${id}`,
  duration_ms: 201_400,
  artists: [{ name: 'One' }, { name: 'Two' }],
  album: {
    name: 'Album',
    images: [
      { url: 'big.jpg', width: 640, height: 640 },
      { url: 'medium.jpg', width: 300, height: 300 },
      { url: 'small.jpg', width: 64, height: 64 },
    ],
  },
  external_urls: { spotify: `https://open.spotify.com/track/${id}` },
});

describe('Song', () => {
  it('migrates songs saved before Spotify support to source "local"', () => {
    const { source: _ignored, ...old } = song('Old');
    const migrated = migrateSong(old);
    expect(migrated.source).toBe('local');
    expect(migrated.id).toBe('Old');
    const current = spotifySong('abc');
    expect(migrateSong(current)).toBe(current);
  });

  it('builds a Spotify song from a Web API track with the id "spotify:<id>"', () => {
    const result = songFromTrack(track('4uLU6hMCjMI75M1A2tKUQC'), 123);
    expect(result).toMatchObject({
      source: 'spotify',
      id: 'spotify:4uLU6hMCjMI75M1A2tKUQC',
      spotifyId: '4uLU6hMCjMI75M1A2tKUQC',
      spotifyUri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
      artist: 'One, Two',
      duration: 201,
      coverUrl: 'medium.jpg',
      externalUrl: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      addedAt: 123,
    });
    expect(spotifySongId('x')).toBe('spotify:x');
  });

  it('never stores the same Spotify track twice in the library', () => {
    const library = new PlaylistLibrary();
    library.importSongs([song('Local')], library.allSongs.id);
    const first = library.saveToLibrary([songFromTrack(track('t1'))]);
    expect(first.added).toHaveLength(1);

    // Found again in a later search: a new object with the same id.
    const again = library.saveToLibrary([songFromTrack(track('t1')), songFromTrack(track('t2')), songFromTrack(track('t2'))]);
    expect(again.added.map((s) => s.id)).toEqual(['spotify:t2']);
    expect(again.songs[0]).toBe(first.songs[0]); // the library's own object
    expect(titlesOf(library.allSongs.songs)).toEqual(['Local', 'Track t1', 'Track t2']);
  });
});
