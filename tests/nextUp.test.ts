import { describe, expect, it } from 'vitest';
import { PlaybackQueue } from '../src/core/PlaybackQueue';
import type { RepeatMode } from '../src/core/Playlist';
import { Playlist } from '../src/core/Playlist';
import { edgeScrollSpeed } from '../src/ui/dragScroll';
import { nextUp } from '../src/ui/nextUp';
import { song } from './helpers';

/** The "next" state of a queue loaded from `titles`, positioned on `currentIndex`. */
function stateFor(titles: string[], currentIndex: number, repeat: RepeatMode) {
  const playlist = new Playlist('p', 'P');
  playlist.addMany(titles.map((title) => song(title)));
  const queue = new PlaybackQueue();
  queue.load(playlist, titles[currentIndex], false);
  return nextUp({
    current: queue.current,
    repeat,
    following: queue.peekNext(repeat),
    upcoming: queue.upcoming(30, repeat),
  });
}

const titlesOf = (songs: { title: string }[]) => songs.map((item) => item.title);

describe('nextUp', () => {
  it("repeat 'one': the next song is the current one and the queue says it repeats", () => {
    const last = stateFor(['A', 'B', 'C'], 2, 'one');
    expect(last.next?.title).toBe('C');
    expect(last.canSkip).toBe(true);
    expect(last.note).toBe('repeatOne');
    expect(last.items).toEqual([]);

    const middle = stateFor(['A', 'B', 'C'], 0, 'one');
    expect(middle.next?.title).toBe('A');
    expect(titlesOf(middle.items)).toEqual(['B', 'C']);
    expect(middle.note).toBe('repeatOne');
  });

  it("repeat 'all': wraps, so it is never empty while there are songs", () => {
    const last = stateFor(['A', 'B', 'C'], 2, 'all');
    expect(last.next?.title).toBe('A');
    expect(last.canSkip).toBe(true);
    expect(titlesOf(last.items)).toEqual(['A', 'B']);
    expect(last.note).toBeNull();

    const single = stateFor(['Solo'], 0, 'all');
    expect(single.next?.title).toBe('Solo');
    expect(titlesOf(single.items)).toEqual(['Solo']);
    expect(single.note).toBeNull();
    expect(single.canSkip).toBe(true);
  });

  it("repeat 'off': at the end there is no next song, the next key is disabled and the queue ends", () => {
    const last = stateFor(['A', 'B', 'C'], 2, 'off');
    expect(last.next).toBeNull();
    expect(last.canSkip).toBe(false);
    expect(last.items).toEqual([]);
    expect(last.note).toBe('end');

    const first = stateFor(['A', 'B', 'C'], 0, 'off');
    expect(first.next?.title).toBe('B');
    expect(first.canSkip).toBe(true);
    expect(first.note).toBeNull();
  });

  it('with nothing playing the queue is empty and the next key is disabled', () => {
    for (const repeat of ['off', 'all', 'one'] as const) {
      expect(nextUp({ current: null, repeat, following: null, upcoming: [] })).toEqual({
        next: null,
        canSkip: false,
        items: [],
        note: 'empty',
      });
    }
  });
});

describe('edgeScrollSpeed', () => {
  it('scrolls up near the top and down near the bottom, faster closer to the edge', () => {
    expect(edgeScrollSpeed(100, 0, 400)).toBe(0);
    expect(edgeScrollSpeed(0, 0, 400)).toBe(-14);
    expect(edgeScrollSpeed(24, 0, 400)).toBe(-7);
    expect(edgeScrollSpeed(400, 0, 400)).toBe(14);
    expect(edgeScrollSpeed(376, 0, 400)).toBe(7);
  });

  it('keeps the maximum speed beyond the edges', () => {
    expect(edgeScrollSpeed(-50, 0, 400)).toBe(-14);
    expect(edgeScrollSpeed(480, 0, 400)).toBe(14);
  });

  it('shrinks the zones in a short list and does nothing in an empty one', () => {
    expect(edgeScrollSpeed(30, 0, 60)).toBe(0);
    expect(edgeScrollSpeed(0, 0, 60)).toBe(-14);
    expect(edgeScrollSpeed(10, 50, 50)).toBe(0);
  });
});
