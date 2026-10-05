import type { Song } from '../core/Song';

/** Keeps one object URL per cover so images are not recreated on every render. */
export class CoverCache {
  private readonly urls = new Map<string, string>();

  get(song: Song | null): string | null {
    if (!song?.cover) return null;
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
