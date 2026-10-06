import type { Song } from '../core/Song';

/**
 * Cover image URL of a song: one object URL per embedded cover of a local file (so
 * images are not recreated on every render), or the Spotify image URL as is.
 */
export class CoverCache {
  private readonly urls = new Map<string, string>();

  get(song: Song | null): string | null {
    if (!song) return null;
    if (song.source === 'spotify') return song.coverUrl;
    if (!song.cover) return null;
    let url = this.urls.get(song.id);
    if (!url) {
      url = URL.createObjectURL(song.cover);
      this.urls.set(song.id, url);
    }
    return url;
  }

  release(id: string): void {
    const url = this.urls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(id);
  }

  releaseAll(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
