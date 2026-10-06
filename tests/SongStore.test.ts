import { describe, expect, it } from 'vitest';
import { migrateState } from '../src/services/SongStore';

describe('saved state migration', () => {
  it('turns a version 3 state into the current format with a queue and puts back the shuffled playlist order', () => {
    const migrated = migrateState({
      version: 3,
      playlists: [
        { id: 'all', name: '', order: ['A', 'B', 'C'], currentId: 'A' },
        { id: 'p1', name: 'Mix', order: ['C', 'A', 'B', 'N'], currentId: 'C' },
      ],
      activeId: 'p1',
      viewedId: 'all',
      repeat: 'off',
      volume: 0.5,
      position: 12,
      dock: 'panel',
      stageWidth: 360,
      shuffle: true,
      shuffled: { playlistId: 'p1', order: ['A', 'B', 'X', 'C'] },
    });
    expect(migrated.version).toBe(6);
    expect(migrated.view).toBe('now');
    expect(migrated).not.toHaveProperty('dock');
    // Original order, without the deleted X, with N (added while shuffled) at the end.
    expect(migrated.playlists[1]).toEqual({ id: 'p1', name: 'Mix', order: ['A', 'B', 'C', 'N'] });
    expect(migrated.queue).toEqual({ sourceId: 'p1', order: null, currentId: 'C', shuffle: true });
    expect(migrated.repeat).toBe('off');
  });

  it("starts older states with repeat 'all'", () => {
    const migrated = migrateState({ order: ['A'], currentId: 'A', repeat: 'off', volume: 1, position: 0 });
    expect(migrated.repeat).toBe('all');
    expect(migrated.queue).toEqual({ sourceId: 'all', order: null, currentId: 'A', shuffle: false });
  });

  it('turns a version 5 state into version 6 with the player screen', () => {
    const migrated = migrateState({
      version: 5,
      playlists: [{ id: 'all', name: '', order: ['A'] }],
      viewedId: 'all',
      repeat: 'one',
      volume: 0.4,
      position: 30,
      dock: 'mini',
      stageWidth: 420,
      queue: { sourceId: 'all', order: ['A'], currentId: 'A', shuffle: false },
    });
    expect(migrated).toEqual({
      version: 6,
      playlists: [{ id: 'all', name: '', order: ['A'] }],
      viewedId: 'all',
      repeat: 'one',
      volume: 0.4,
      position: 30,
      view: 'now',
      queue: { sourceId: 'all', order: ['A'], currentId: 'A', shuffle: false },
    });
  });
});
