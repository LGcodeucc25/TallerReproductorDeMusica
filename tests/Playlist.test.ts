import { describe, expect, it } from 'vitest';
import { Playlist } from '../src/core/Playlist';
import { song, titlesOf } from './helpers';

const newPlaylist = () => new Playlist('p1', 'Test');
const titles = (playlist: Playlist) => titlesOf(playlist.songs);

describe('Playlist', () => {
  it('adds at the start, the end and a slot in between', () => {
    const playlist = newPlaylist();
    playlist.add(song('B'));
    playlist.add(song('A'), 0);
    playlist.add(song('D'));
    playlist.add(song('C'), 2);
    expect(titles(playlist)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('keeps the given order when adding many at the start or in between', () => {
    const playlist = newPlaylist();
    playlist.add(song('Z'));
    playlist.addMany([song('A'), song('B')], 0);
    playlist.addMany([song('M'), song('N')], 2);
    expect(titles(playlist)).toEqual(['A', 'B', 'M', 'N', 'Z']);
  });

  it('removes by index and by id', () => {
    const playlist = newPlaylist();
    playlist.addMany([song('A'), song('B'), song('C')]);
    expect(playlist.removeAt(1)?.title).toBe('B');
    expect(playlist.removeById('C')?.title).toBe('C');
    expect(playlist.removeById('X')).toBeNull();
    expect(titles(playlist)).toEqual(['A']);
  });

  it('moves and reverses by relinking the same nodes', () => {
    const playlist = newPlaylist();
    playlist.addMany([song('A'), song('B'), song('C')]);
    const nodes = new Set(playlist.songs.nodes());
    playlist.move(0, 2);
    expect(titles(playlist)).toEqual(['B', 'C', 'A']);
    playlist.reverse();
    expect(titles(playlist)).toEqual(['A', 'C', 'B']);
    for (const node of playlist.songs.nodes()) expect(nodes.has(node)).toBe(true);
  });

  it('sortBy sorts by title, artist and recently added, notifying once each', () => {
    const playlist = newPlaylist();
    playlist.addMany([
      song('Song 10', { artist: 'Zoe', addedAt: 3 }),
      song('song 2', { artist: 'Abba', addedAt: 1 }),
      song('Beautiful', { artist: 'Zoe', addedAt: 2 }),
    ]);
    let notifications = 0;
    playlist.subscribe(() => notifications++);

    playlist.sortBy('title');
    expect(titles(playlist)).toEqual(['Beautiful', 'song 2', 'Song 10']);
    expect(notifications).toBe(1);

    playlist.sortBy('artist');
    expect(titles(playlist)).toEqual(['song 2', 'Beautiful', 'Song 10']);

    playlist.sortBy('recent');
    expect(titles(playlist)).toEqual(['Song 10', 'Beautiful', 'song 2']);
  });

  it('snapshot stores the order of ids', () => {
    const playlist = newPlaylist();
    playlist.addMany([song('A'), song('B')]);
    expect(playlist.snapshot()).toEqual({ id: 'p1', name: 'Test', order: ['A', 'B'] });
  });
});
