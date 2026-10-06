import { describe, expect, it } from 'vitest';
import { PlaybackQueue } from '../src/core/PlaybackQueue';
import { Playlist } from '../src/core/Playlist';
import { seeded, song, spotifySong, titlesOf } from './helpers';

function playlistOf(...titles: string[]): Playlist {
  const playlist = new Playlist('p1', 'Test');
  playlist.addMany(titles.map((title) => song(title)));
  return playlist;
}

const order = (queue: PlaybackQueue) => titlesOf(queue.songs);
const sorted = (values: string[]) => [...values].sort();

describe('PlaybackQueue', () => {
  describe('load', () => {
    it('copies the playlist order with new nodes pointing to the same songs', () => {
      const playlist = playlistOf('A', 'B', 'C', 'D');
      const queue = new PlaybackQueue();
      queue.load(playlist, 'C', false);
      expect(order(queue)).toEqual(['A', 'B', 'C', 'D']);
      expect(queue.current?.title).toBe('C');
      expect(queue.sourceId).toBe('p1');
      expect(queue.songs.head).not.toBe(playlist.songs.head);
      expect(queue.songs.head?.value).toBe(playlist.songs.head?.value);
    });

    it('starts at the first song without a start id', () => {
      const queue = new PlaybackQueue();
      queue.load(playlistOf('A', 'B'), null, false);
      expect(queue.current?.title).toBe('A');
    });

    it('with shuffle puts the start song at head and shuffles the rest, keeping every song once', () => {
      const playlist = playlistOf('A', 'B', 'C', 'D', 'E', 'F');
      const queue = new PlaybackQueue(seeded(3));
      queue.load(playlist, 'D', true);
      expect(queue.shuffle).toBe(true);
      expect(queue.songs.head?.value.title).toBe('D');
      expect(queue.current?.title).toBe('D');
      expect(sorted(order(queue))).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
      expect(titlesOf(playlist.songs)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    });
  });

  it('moveSong changes the queue but never the source playlist', () => {
    const playlist = playlistOf('A', 'B', 'C', 'D', 'E');
    const queue = new PlaybackQueue();
    queue.load(playlist, 'D', false); // with repeat all, up next is E, A, B, C
    expect(queue.upcoming(10, 'all').map((s) => s.title)).toEqual(['E', 'A', 'B', 'C']);

    expect(queue.moveSong('B', 'E', 'before')).toBe(true); // across the tail → head wrap
    expect(order(queue)).toEqual(['A', 'C', 'D', 'B', 'E']);
    expect(queue.upcoming(10, 'all').map((s) => s.title)).toEqual(['B', 'E', 'A', 'C']);
    expect(queue.moveSong('D', 'A', 'before')).toBe(false); // the current song never moves
    expect(queue.moveSong('A', 'A', 'after')).toBe(false);
    expect(titlesOf(playlist.songs)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  describe('playNext', () => {
    it('inserts after the current song without changing the playlist', () => {
      const playlist = playlistOf('A', 'B', 'C');
      const queue = new PlaybackQueue();
      queue.load(playlist, 'A', false);
      queue.playNext(song('X'));
      expect(order(queue)).toEqual(['A', 'X', 'B', 'C']);
      expect(queue.current?.title).toBe('A');
      expect(titlesOf(playlist.songs)).toEqual(['A', 'B', 'C']);
    });

    it('moves the node when the song is already queued, without duplicating it', () => {
      const queue = new PlaybackQueue();
      queue.load(playlistOf('A', 'B', 'C', 'D'), 'B', false);
      const nodeD = queue.songs.tail;
      queue.playNext(song('D'));
      expect(order(queue)).toEqual(['A', 'B', 'D', 'C']);
      expect(queue.songs.traverseToIndex(2)).toBe(nodeD);
      expect(queue.size).toBe(4);
    });

    it('appends and becomes current in an empty queue', () => {
      const queue = new PlaybackQueue();
      queue.playNext(song('X'));
      expect(order(queue)).toEqual(['X']);
      expect(queue.current?.title).toBe('X');
    });
  });

  describe('repeat', () => {
    it("'all' wraps from tail to head; 'off' stops at the end", () => {
      const queue = new PlaybackQueue();
      queue.load(playlistOf('A', 'B'), 'B', false);
      expect(queue.peekNext('off')).toBeNull();
      expect(queue.next('off')).toBeNull();
      expect(queue.peekNext('all')?.title).toBe('A');
      expect(queue.next('all')?.title).toBe('A');
      expect(queue.peekPrevious('all')?.title).toBe('B');
      expect(queue.previous('all')?.title).toBe('B');
    });

    it("'one' replays only when the song ends", () => {
      const queue = new PlaybackQueue();
      queue.load(playlistOf('A', 'B'), 'A', false);
      expect(queue.peekNext('one')?.title).toBe('A');
      expect(queue.next('one', true)?.title).toBe('A');
      expect(queue.next('one')?.title).toBe('B');
    });

    it('upcoming never includes the current song when it wraps', () => {
      const queue = new PlaybackQueue();
      queue.load(playlistOf('A', 'B', 'C'), 'B', false);
      expect(queue.upcoming(10, 'all').map((s) => s.title)).toEqual(['C', 'A']);
      expect(queue.upcomingCount('all')).toBe(2);
      expect(queue.upcoming(10, 'off').map((s) => s.title)).toEqual(['C']);
    });

    it('a shuffled wrap reshuffles, keeps every song exactly once and starts with the previewed song', () => {
      const titles = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
      const queue = new PlaybackQueue(seeded(42));
      queue.load(playlistOf(...titles), null, true);
      const rounds: string[][] = [order(queue)];

      for (let round = 0; round < 5; round++) {
        for (let i = 1; i < titles.length; i++) queue.next('all');
        const lastPlayed = queue.current!.title;
        const previewed = queue.peekNext('all')!.title;
        expect(previewed).not.toBe(lastPlayed);
        expect(queue.upcoming(10, 'all').map((s) => s.title)).toEqual([previewed]);

        expect(queue.next('all')?.title).toBe(previewed);
        const now = order(queue);
        expect(sorted(now)).toEqual(titles);
        expect(now[0]).not.toBe(lastPlayed);
        rounds.push(now);
      }
      // Rounds are reshuffled, not repeated.
      expect(new Set(rounds.map((round) => round.join(''))).size).toBeGreaterThan(1);
    });
  });

  describe('syncWith', () => {
    it('removes songs deleted from the playlist and appends new ones', () => {
      const playlist = playlistOf('A', 'B', 'C');
      const queue = new PlaybackQueue();
      queue.load(playlist, 'B', false);
      queue.playNext(song('X')); // only in the queue: must survive the sync

      playlist.removeById('C');
      playlist.add(song('D'), 0);
      expect(queue.syncWith(playlist)).toBe(true);
      expect(order(queue)).toEqual(['A', 'B', 'X', 'D']);
      expect(queue.current?.title).toBe('B');
    });

    it('moves the current song to its neighbour when it is removed', () => {
      const playlist = playlistOf('A', 'B', 'C');
      const queue = new PlaybackQueue();
      queue.load(playlist, 'B', false);
      playlist.removeById('B');
      queue.syncWith(playlist);
      expect(queue.current?.title).toBe('C');
    });

    it('follows a reorder of the playlist keeping the current song', () => {
      const playlist = playlistOf('A', 'B', 'C', 'D');
      const queue = new PlaybackQueue();
      queue.load(playlist, 'C', false);
      playlist.reverse();
      queue.syncWith(playlist);
      expect(order(queue)).toEqual(['D', 'C', 'B', 'A']);
      expect(queue.current?.title).toBe('C');
    });

    it('keeps manual queue changes when the playlist changes without a reorder', () => {
      const playlist = playlistOf('A', 'B', 'C', 'D');
      const queue = new PlaybackQueue();
      queue.load(playlist, 'A', false);
      queue.moveSong('D', 'A', 'after');
      playlist.rename('Renamed');
      expect(queue.syncWith(playlist)).toBe(false);
      expect(order(queue)).toEqual(['A', 'D', 'B', 'C']);
    });

    it('inserts new songs after the current one in shuffle mode', () => {
      const playlist = playlistOf('A', 'B', 'C', 'D');
      const queue = new PlaybackQueue(seeded(9));
      queue.load(playlist, 'B', true);
      playlist.add(song('N'), 0);
      queue.syncWith(playlist);
      const now = order(queue);
      expect(sorted(now)).toEqual(['A', 'B', 'C', 'D', 'N']);
      expect(now.indexOf('N')).toBeGreaterThan(now.indexOf('B'));
    });
  });

  it('setShuffle(false) restores the playlist order keeping the current song', () => {
    const playlist = playlistOf('A', 'B', 'C', 'D', 'E', 'F');
    const queue = new PlaybackQueue(seeded(5));
    queue.load(playlist, 'C', false);
    queue.setShuffle(true, playlist);
    expect(queue.songs.head?.value.title).toBe('C');
    expect(queue.current?.title).toBe('C');

    queue.setShuffle(false, playlist);
    expect(order(queue)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(queue.current?.title).toBe('C');
    expect(titlesOf(playlist.songs)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('snapshot and restore keep order, current song and shuffle flag', () => {
    const playlist = playlistOf('A', 'B', 'C');
    const queue = new PlaybackQueue();
    queue.load(playlist, 'B', false);
    queue.moveSong('C', 'A', 'before');
    const saved = queue.snapshot();
    expect(saved).toEqual({ sourceId: 'p1', order: ['C', 'A', 'B'], currentId: 'B', shuffle: false, continuous: [] });

    const restored = new PlaybackQueue();
    restored.restore(playlist, saved.order.map((id) => song(id)), saved.currentId, saved.shuffle);
    expect(order(restored)).toEqual(['C', 'A', 'B']);
    expect(restored.current?.title).toBe('B');
  });

  describe('mixed local and Spotify songs', () => {
    const mixed = () => {
      const playlist = new Playlist('mix', 'Mix');
      playlist.addMany([song('L1'), spotifySong('S1'), spotifySong('S2'), song('L2'), spotifySong('S3')]);
      return playlist;
    };
    const localOnly = (s: { source: string }) => s.source === 'local';

    it('plays both sources the same way when Spotify is connected', () => {
      const queue = new PlaybackQueue();
      queue.load(mixed(), null, false);
      expect([queue.next('off'), queue.next('off'), queue.next('off')].map((s) => s?.title)).toEqual(['S1', 'S2', 'L2']);
      expect(queue.lastSkipped).toBe(0);
    });

    it('skips Spotify songs when disconnected, wrapping with repeat all', () => {
      const queue = new PlaybackQueue();
      queue.setPlayable(localOnly);
      queue.load(mixed(), null, false);
      expect(queue.current?.title).toBe('L1');
      expect(queue.next('off')?.title).toBe('L2');
      expect(queue.lastSkipped).toBe(2);
      expect(queue.peekNext('off')).toBeNull(); // only S3 is left after L2
      expect(queue.next('all')?.title).toBe('L1');
      expect(queue.previous('all')?.title).toBe('L2');
      expect(queue.upcoming(10, 'all').map((s) => s.title)).toEqual(['L1']);
      expect(queue.hasNext('off')).toBe(false);
    });

    it('starts at the first playable song when the start is not playable', () => {
      const playlist = new Playlist('p', 'P');
      playlist.addMany([spotifySong('S1'), spotifySong('S2'), song('L1')]);
      const queue = new PlaybackQueue();
      queue.setPlayable(localOnly);
      queue.load(playlist, null, false);
      expect(queue.current?.title).toBe('L1');
      expect(queue.lastSkipped).toBe(2);
    });

    it('a shuffled round never starts with an unplayable song and keeps every song once', () => {
      const queue = new PlaybackQueue(seeded(21));
      queue.setPlayable(localOnly);
      queue.load(mixed(), 'L1', true);
      const before = sortedTitles(queue);
      for (let i = 0; i < 6; i++) {
        const next = queue.next('all');
        expect(next?.source).toBe('local');
      }
      expect(sortedTitles(queue)).toEqual(before);
    });

    it('returns null when nothing can play', () => {
      const playlist = new Playlist('p', 'P');
      playlist.addMany([spotifySong('S1'), spotifySong('S2')]);
      const queue = new PlaybackQueue();
      queue.setPlayable(localOnly);
      queue.load(playlist, null, false);
      expect(queue.next('all')).toBeNull();
      expect(queue.peekNext('all')).toBeNull();
    });
  });
});

function sortedTitles(queue: PlaybackQueue): string[] {
  return titlesOf(queue.songs).sort();
}
