import { describe, expect, it } from 'vitest';
import { advanceAfterEnd, extendIfAtEnd, type ContinuousSources } from '../src/core/continuousPlay';
import { PlaybackQueue } from '../src/core/PlaybackQueue';
import { Playlist, type RepeatMode } from '../src/core/Playlist';
import type { Song } from '../src/core/Song';
import { EngineEvents, type EngineEvent, type EngineListener, type PlaybackEngine } from '../src/services/PlaybackEngine';
import { endCheckDelay, END_CHECK_GRACE_MS } from '../src/services/spotify/trackEnd';
import { nextUp } from '../src/ui/nextUp';
import { seeded, song, spotifySong, titlesOf } from './helpers';

function playlistOf(id: string, songs: Song[]): Playlist {
  const playlist = new Playlist(id, id);
  playlist.addMany(songs);
  return playlist;
}

/** A queue loaded from `source`, positioned on `currentTitle`. */
function queueOn(source: Playlist, currentTitle: string, seed = 7): PlaybackQueue {
  const queue = new PlaybackQueue(seeded(seed));
  queue.load(source, [...source.songs].find((item) => item.title === currentTitle)!.id, false);
  return queue;
}

const sorted = (values: string[]) => [...values].sort();

describe('reshuffleUpcoming', () => {
  const songs = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((title) => song(title));

  it('keeps the current song and every song before it, and shuffles the rest by relinking', () => {
    const queue = queueOn(playlistOf('p', songs), 'D', 3);
    const nodesBefore = [...queue.songs.nodes()];
    let emits = 0;
    queue.subscribe(() => emits++);

    expect(queue.reshuffleUpcoming(seeded(11))).toBe(true);
    const order = titlesOf(queue.songs); // also checks every link in both directions
    expect(order.slice(0, 4)).toEqual(['A', 'B', 'C', 'D']);
    expect(sorted(order.slice(4))).toEqual(['E', 'F', 'G', 'H']);
    expect(order.slice(4)).not.toEqual(['E', 'F', 'G', 'H']);
    expect(queue.current?.title).toBe('D');
    expect(queue.peekPrevious('off')?.title).toBe('C');
    expect(emits).toBe(1);
    // No new nodes: the same node objects, only relinked.
    expect(new Set(queue.songs.nodes())).toEqual(new Set(nodesBefore));
  });

  it('never changes the shuffle flag, and setShuffle(false) still restores the playlist order', () => {
    const source = playlistOf('p', songs);
    const off = queueOn(source, 'B');
    off.reshuffleUpcoming(seeded(5));
    expect(off.shuffle).toBe(false);
    off.setShuffle(true, source);
    off.setShuffle(false, source);
    expect(titlesOf(off.songs)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);

    const on = new PlaybackQueue(seeded(2));
    on.load(source, 'A', true);
    on.reshuffleUpcoming(seeded(9));
    expect(on.shuffle).toBe(true);
    expect(on.current?.title).toBe('A');
    expect(sorted(titlesOf(on.songs))).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });

  it('does nothing with fewer than two songs after the current one', () => {
    const queue = queueOn(playlistOf('p', songs), 'G');
    let emits = 0;
    queue.subscribe(() => emits++);
    expect(queue.songsAfterCurrent).toBe(1);
    expect(queue.reshuffleUpcoming()).toBe(false);
    expect(emits).toBe(0);
    expect(titlesOf(queue.songs)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });
});

describe('continuous playback', () => {
  const [a, b, c, d, e, f] = ['A', 'B', 'C', 'D', 'E', 'F'].map((title) => song(title));
  const library = playlistOf('all', [a, b, c, d, e, f]);
  const rock = playlistOf('rock', [a, b, c]);
  const sources = (source: Playlist): ContinuousSources => ({ library: library.songs, source: source.songs });

  it('appends the library songs that are not queued yet, shuffled, after the last song', () => {
    const queue = queueOn(rock, 'C');
    expect(extendIfAtEnd(queue, 'off', sources(rock))).toBe(true);
    const order = titlesOf(queue.songs);
    expect(order.slice(0, 3)).toEqual(['A', 'B', 'C']);
    expect(sorted(order.slice(3))).toEqual(['D', 'E', 'F']);
    expect(queue.current?.title).toBe('C');
    expect(queue.isAutoAdded(d) && queue.isAutoAdded(e) && queue.isAutoAdded(f)).toBe(true);
    expect(queue.isAutoAdded(a)).toBe(false);
    expect(queue.peekNext('off')?.title).toBe(order[3]);
    // The queue snapshot keeps them (and which ones were added).
    expect(sorted(queue.snapshot().continuous!)).toEqual(['D', 'E', 'F']);
  });

  it('only adds when the last playable song is current', () => {
    const queue = queueOn(rock, 'B');
    expect(extendIfAtEnd(queue, 'off', sources(rock))).toBe(false);
    expect(titlesOf(queue.songs)).toEqual(['A', 'B', 'C']);
  });

  it('starts a new shuffled round of the source when every library song is already queued', () => {
    const everything = playlistOf('all', [a, b, c]);
    const queue = queueOn(everything, 'C');
    expect(extendIfAtEnd(queue, 'off', { library: everything.songs, source: everything.songs })).toBe(true);
    const order = titlesOf(queue.songs);
    expect(order[0]).toBe('C');
    expect(sorted(order.slice(1))).toEqual(['A', 'B']);
    expect(queue.current?.title).toBe('C');
    expect(queue.peekNext('off')).not.toBeNull();
  });

  it('skips songs that cannot play (Spotify while disconnected)', () => {
    const remote = [spotifySong('X'), spotifySong('Y')];
    const mixed = playlistOf('all', [a, b, ...remote, d]);
    const queue = queueOn(playlistOf('p', [a, b]), 'B');
    queue.setPlayable((item) => item.source === 'local');
    expect(extendIfAtEnd(queue, 'off', { library: mixed.songs, source: [a, b] })).toBe(true);
    expect(titlesOf(queue.songs)).toEqual(['A', 'B', 'D']);
  });

  it('adds nothing when nothing playable is left, so the next card shows a dash', () => {
    const lonely = playlistOf('all', [a, spotifySong('X')]);
    const queue = queueOn(playlistOf('p', [a]), 'A');
    queue.setPlayable((item) => item.source === 'local');
    let emits = 0;
    queue.subscribe(() => emits++);
    expect(extendIfAtEnd(queue, 'off', { library: lonely.songs, source: [a] })).toBe(false);
    expect(emits).toBe(0);
    const state = nextUp({ current: queue.current, repeat: 'off', following: queue.peekNext('off'), upcoming: queue.upcoming(30, 'off') });
    expect(state.next).toBeNull();
    expect(state.note).toBe('end');
  });

  it("with repeat 'off' the next card shows the first added song, never a dash", () => {
    const queue = queueOn(rock, 'C');
    extendIfAtEnd(queue, 'off', sources(rock));
    const state = nextUp({ current: queue.current, repeat: 'off', following: queue.peekNext('off'), upcoming: queue.upcoming(30, 'off') });
    expect(state.next?.title).toBe(titlesOf(queue.songs)[3]);
    expect(state.canSkip).toBe(true);
    expect(state.note).toBeNull();
  });

  it("leaves repeat 'one' and 'all' as they are", () => {
    for (const repeat of ['one', 'all'] as const) {
      const queue = queueOn(rock, 'C');
      expect(extendIfAtEnd(queue, repeat, sources(rock))).toBe(false);
      expect(titlesOf(queue.songs)).toEqual(['A', 'B', 'C']);
    }
    const all = queueOn(rock, 'C');
    expect(advanceAfterEnd(all, 'all', 'C', sources(rock))).toEqual({ kind: 'next', song: a });
    const one = queueOn(rock, 'C');
    expect(advanceAfterEnd(one, 'one', 'C', sources(rock))).toEqual({ kind: 'replay', song: c });
    expect(titlesOf(one.songs)).toEqual(['A', 'B', 'C']);
  });

  it('keeps the added songs (and the divider marks) through snapshot and restore', () => {
    const queue = queueOn(rock, 'C');
    extendIfAtEnd(queue, 'off', sources(rock));
    const saved = queue.snapshot();
    const restored = new PlaybackQueue();
    const byId = new Map([...library.songs].map((item) => [item.id, item]));
    restored.restore(rock, saved.order.map((id) => byId.get(id)!), saved.currentId, saved.shuffle, saved.continuous);
    expect(titlesOf(restored.songs)).toEqual(titlesOf(queue.songs));
    expect(restored.isAutoAdded(d)).toBe(true);
    expect(restored.isAutoAdded(c)).toBe(false);
  });
});

/** Engine double: records what it was asked to do and fires 'ended' on demand. */
class MockEngine implements PlaybackEngine {
  private readonly events = new EngineEvents();
  loaded: Song | null = null;
  plays = 0;
  seeks: number[] = [];
  paused = true;
  currentTime = 0;
  duration = 0;

  constructor(readonly kind: Song['source']) {}

  load(item: Song): void {
    this.loaded = item;
    this.paused = true;
  }
  unload(): void {
    this.loaded = null;
    this.paused = true;
  }
  async play(): Promise<boolean> {
    this.plays++;
    this.paused = false;
    return true;
  }
  pause(): void {
    this.paused = true;
  }
  seek(seconds: number): void {
    this.seeks.push(seconds);
  }
  setVolume(): void {}
  on(event: EngineEvent, listener: EngineListener): () => void {
    return this.events.on(event, listener);
  }
  /** The song played to its end. */
  finish(): void {
    this.paused = true;
    this.events.emit('ended');
  }
}

/**
 * The same wiring as the app: the active engine's 'ended' goes through
 * advanceAfterEnd, and the next song loads in the engine of its source.
 */
class Player {
  readonly local = new MockEngine('local');
  readonly spotify = new MockEngine('spotify');
  engine: MockEngine = this.local;
  stopped = false;

  constructor(
    readonly queue: PlaybackQueue,
    private readonly repeat: RepeatMode,
    private readonly sources: ContinuousSources,
  ) {
    for (const engine of [this.local, this.spotify]) {
      engine.on('ended', () => {
        if (engine !== this.engine) return;
        const outcome = advanceAfterEnd(this.queue, this.repeat, engine.loaded?.id ?? null, this.sources);
        if (outcome.kind === 'stop') this.stopped = true;
        else if (outcome.kind === 'replay') {
          engine.seek(0);
          void engine.play();
        } else this.start();
      });
    }
  }

  start(): void {
    const current = this.queue.current!;
    const engine = current.source === 'spotify' ? this.spotify : this.local;
    if (engine !== this.engine) this.engine.unload();
    this.engine = engine;
    engine.load(current);
    void engine.play();
  }
}

describe('end of the queue: the ended flow for both engines', () => {
  const localA = song('A');
  const remoteB = spotifySong('B');
  const localC = song('C');
  const source = playlistOf('mix', [localA, remoteB]);
  const library = playlistOf('all', [localA, remoteB, localC]);
  const sources: ContinuousSources = { library: library.songs, source: source.songs };

  /** A player on the last song of `source`, which plays on the Spotify engine. */
  function onLastSpotifySong(repeat: RepeatMode): Player {
    const player = new Player(queueOn(source, 'B'), repeat, sources);
    player.start();
    expect(player.engine).toBe(player.spotify);
    return player;
  }

  it("repeat 'off': the last Spotify song ends and continuous playback plays the next song", () => {
    const player = onLastSpotifySong('off');
    player.spotify.finish();
    expect(player.stopped).toBe(false);
    expect(player.engine).toBe(player.local);
    expect(player.local.loaded?.title).toBe('C');
    expect(player.local.paused).toBe(false);
    expect(player.queue.isAutoAdded(localC)).toBe(true);
  });

  it("repeat 'all': wraps to the head, on the local engine", () => {
    const player = onLastSpotifySong('all');
    player.spotify.finish();
    expect(player.local.loaded?.title).toBe('A');
    expect(player.local.paused).toBe(false);
    expect(titlesOf(player.queue.songs)).toEqual(['A', 'B']);
  });

  it("repeat 'all' with shuffle: wraps into a reshuffled round that starts with another song", () => {
    const queue = new PlaybackQueue(seeded(4));
    queue.load(playlistOf('p', [song('P'), song('Q'), song('R')]), 'P', true);
    while (queue.peekNext('off')) queue.next('off');
    const last = queue.current!;
    const player = new Player(queue, 'all', sources);
    player.start();
    player.local.finish();
    expect(player.local.loaded).not.toBe(last);
    expect(player.local.paused).toBe(false);
    expect(queue.songs.head?.value).toBe(queue.current);
  });

  it("repeat 'one': the same Spotify song starts again from 0", () => {
    const player = onLastSpotifySong('one');
    player.spotify.finish();
    expect(player.engine).toBe(player.spotify);
    expect(player.spotify.loaded?.title).toBe('B');
    expect(player.spotify.seeks).toEqual([0]);
    expect(player.spotify.plays).toBe(2);
  });

  it('the last local song ends and the next one plays, in every repeat mode', () => {
    const expected: Record<RepeatMode, string> = { off: 'C', all: 'A', one: 'B' };
    const locals = playlistOf('p', [localA, song('B')]);
    for (const repeat of ['off', 'all', 'one'] as const) {
      const player = new Player(queueOn(locals, 'B'), repeat, sources);
      player.start();
      player.local.finish();
      expect(player.local.loaded?.title).toBe(expected[repeat]);
      expect(player.local.paused).toBe(false);
    }
  });

  it('an unplayable song at the end is skipped instead of stopping', () => {
    const queue = queueOn(source, 'A');
    queue.setPlayable((item) => item.source === 'local'); // Spotify disconnected: B cannot play
    const player = new Player(queue, 'off', sources);
    player.start();
    player.local.finish();
    expect(player.stopped).toBe(false);
    expect(player.local.loaded?.title).toBe('C');
  });

  it('stops only when nothing playable is left', () => {
    const lonely = playlistOf('p', [localA]);
    const player = new Player(queueOn(lonely, 'A'), 'off', { library: lonely.songs, source: lonely.songs });
    player.start();
    player.local.finish();
    expect(player.stopped).toBe(true);
  });
});

describe('Spotify end check timer', () => {
  it('runs right after the expected end, and not while paused or with an unknown length', () => {
    const playing = { uri: 'u', paused: false, positionMs: 0, durationMs: 200_000 };
    expect(endCheckDelay(playing, 150_000)).toBe(50_000 + END_CHECK_GRACE_MS);
    expect(endCheckDelay(playing, 250_000)).toBe(END_CHECK_GRACE_MS);
    expect(endCheckDelay({ ...playing, paused: true }, 0)).toBeNull();
    expect(endCheckDelay({ ...playing, durationMs: 0 }, 0)).toBeNull();
  });
});
