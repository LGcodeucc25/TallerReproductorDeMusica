/** Fields every song has, wherever it plays from. Pure data, no DOM access. */
interface SongBase {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Duration in seconds (0 when unknown). */
  duration: number;
  /** When it was added to the library (ms timestamp), used by the "recently added" sort. */
  addedAt: number;
}

/** A file imported from the user's computer, kept in memory and in IndexedDB. */
export interface LocalSong extends SongBase {
  source: 'local';
  fileName: string;
  file: Blob;
  /** Embedded cover art (ID3 APIC frame), if the file has one. */
  cover: Blob | null;
}

/** A Spotify track: only its metadata is stored; the audio is streamed by Spotify. */
export interface SpotifySong extends SongBase {
  source: 'spotify';
  spotifyUri: string;
  spotifyId: string;
  coverUrl: string | null;
  /** The open.spotify.com page of the track (Spotify requires a link back). */
  externalUrl: string;
}

export type Song = LocalSong | SpotifySong;

export type SongSource = Song['source'];

/** Library id of a Spotify track: the same track is never stored twice. */
export function spotifySongId(spotifyId: string): string {
  return `spotify:${spotifyId}`;
}

/** A song as stored in IndexedDB: songs saved before Spotify support have no `source`. */
export type StoredSong = Song | (Omit<LocalSong, 'source'> & { source?: undefined });

/** Songs saved before Spotify support are local files. */
export function migrateSong(saved: StoredSong): Song {
  if (saved.source === undefined) return { ...saved, source: 'local' };
  // `source` is set, so this is already a Song (TypeScript does not narrow an optional discriminant).
  return saved as Song;
}
