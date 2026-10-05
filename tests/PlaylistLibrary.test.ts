import { describe, expect, it } from 'vitest';
import { ALL_SONGS_ID, PlaylistLibrary, type LibraryNames } from '../src/core/PlaylistLibrary';
import { song, titlesOf } from './helpers';

const NAMES: LibraryNames = { allSongs: 'All songs', newPlaylist: (n) => `My playlist ${n}` };

const names = (library: PlaylistLibrary) => [...library.playlists].map((p) => p.name);
const titles = (library: PlaylistLibrary, id: string) => titlesOf(library.get(id)!.songs);

describe('PlaylistLibrary', () => {
  it('starts with the all-songs playlist as head', () => {
    const library = new PlaylistLibrary(NAMES);
    expect(library.playlists.head?.value.id).toBe(ALL_SONGS_ID);
    expect(library.userCount).toBe(0);
  });

  it('creates, renames and removes playlists', () => {
    const library = new PlaylistLibrary(NAMES);
    const rock = library.create('  Classic   rock ');
    const chill = library.create('');
    expect(names(library)).toEqual(['All songs', 'Classic rock', 'My playlist 2']);
    expect(library.rename(chill.id, 'Chill')).toBe(true);
    expect(library.rename(chill.id, '   ')).toBe(false);
    expect(library.rename(ALL_SONGS_ID, 'Other')).toBe(false);
    expect(library.remove(ALL_SONGS_ID)).toBeNull();
    library.remove(rock.id);
    expect(names(library)).toEqual(['All songs', 'Chill']);
  });

  it('reorders playlists but never moves the head', () => {
    const library = new PlaylistLibrary(NAMES);
    library.create('A');
    library.create('B');
    library.create('C');
    expect(library.move(3, 1)).toBe(true);
    expect(names(library)).toEqual(['All songs', 'C', 'A', 'B']);
    expect(library.move(0, 2)).toBe(false);
    expect(library.move(2, 0)).toBe(false);
  });

  it('importing into a playlist also adds to the library', () => {
    const library = new PlaylistLibrary(NAMES);
    const mix = library.create('Mix');
    library.importSongs([song('A'), song('B')], ALL_SONGS_ID);
    library.importSongs([song('C')], mix.id, 0);
    expect(titles(library, ALL_SONGS_ID)).toEqual(['A', 'B', 'C']);
    expect(titles(library, mix.id)).toEqual(['C']);
  });

  it('importSongs drops into slot 0, a middle slot and the end', () => {
    const library = new PlaylistLibrary(NAMES);
    library.importSongs([song('C'), song('D')], ALL_SONGS_ID);
    library.importSongs([song('A'), song('B')], ALL_SONGS_ID, 0);
    expect(titles(library, ALL_SONGS_ID)).toEqual(['A', 'B', 'C', 'D']);
    library.importSongs([song('X'), song('Y')], ALL_SONGS_ID, 2);
    expect(titles(library, ALL_SONGS_ID)).toEqual(['A', 'B', 'X', 'Y', 'C', 'D']);
    library.importSongs([song('Z')], ALL_SONGS_ID, library.allSongs.size);
    expect(titles(library, ALL_SONGS_ID)).toEqual(['A', 'B', 'X', 'Y', 'C', 'D', 'Z']);
  });

  it('dropping into a user playlist also adds the songs at the end of the library', () => {
    const library = new PlaylistLibrary(NAMES);
    const mix = library.create('Mix');
    library.importSongs([song('A')], ALL_SONGS_ID);
    library.importSongs([song('B'), song('C')], mix.id);
    library.importSongs([song('M')], mix.id, 1);
    expect(titles(library, mix.id)).toEqual(['B', 'M', 'C']);
    expect(titles(library, ALL_SONGS_ID)).toEqual(['A', 'B', 'C', 'M']);
  });

  it('shares the same Song object between playlists and skips duplicates', () => {
    const library = new PlaylistLibrary(NAMES);
    const mix = library.create('Mix');
    const a = song('A');
    library.importSongs([a, song('B')], ALL_SONGS_ID);
    expect(library.addToPlaylist(mix.id, [a])).toEqual({ added: 1, skipped: 0 });
    expect(library.addToPlaylist(mix.id, [a])).toEqual({ added: 0, skipped: 1 });
    expect(mix.songs.head?.value).toBe(library.allSongs.songs.head?.value);
  });

  it('removing a song from the library removes it from every playlist', () => {
    const library = new PlaylistLibrary(NAMES);
    const one = library.create('One');
    const two = library.create('Two');
    const songs = [song('A'), song('B')];
    library.importSongs(songs, ALL_SONGS_ID);
    library.addToPlaylist(one.id, songs);
    library.addToPlaylist(two.id, [songs[0]]);
    expect(library.containing('A').map((p) => p.name)).toEqual(['One', 'Two']);

    let notifications = 0;
    library.subscribe(() => notifications++);
    library.removeSongEverywhere('A');
    expect(notifications).toBe(1); // batched
    expect(titles(library, ALL_SONGS_ID)).toEqual(['B']);
    expect(titles(library, one.id)).toEqual(['B']);
    expect(two.size).toBe(0);
  });
});
