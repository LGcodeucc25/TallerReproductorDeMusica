/** A song imported from the user's computer. Pure data, no DOM access. */
export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Duration in seconds (0 when unknown). */
  duration: number;
  fileName: string;
  /** The audio file itself, kept in memory and in IndexedDB. */
  file: Blob;
  /** Embedded cover art (ID3 APIC frame), if the file has one. */
  cover: Blob | null;
  /** When it was added to the library (ms timestamp), used by the "recently added" sort. */
  addedAt: number;
}
