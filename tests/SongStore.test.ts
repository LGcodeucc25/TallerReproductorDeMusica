import { describe, expect, it } from 'vitest';
import { migrateState } from '../src/services/SongStore';

describe('saved state migration', () => {
  it('turns a version 3 state into a version 4 queue and puts back the shuffled playlist order', () => {
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
    expect(migrated.version).toBe(4);
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
});
