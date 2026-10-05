import type { Song } from '../core/Song';

export interface MediaActions {
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  seekTo(seconds: number): void;
}

/** Lets the keyboard media keys and the OS media controls drive the player. */
export function bindMediaSession(actions: MediaActions): void {
  if (!('mediaSession' in navigator)) return;
  const session = navigator.mediaSession;
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ['play', () => actions.play()],
    ['pause', () => actions.pause()],
    ['nexttrack', () => actions.next()],
    ['previoustrack', () => actions.previous()],
    ['seekto', (details) => details.seekTime !== undefined && actions.seekTo(details.seekTime)],
  ];
  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Action not supported by this browser.
    }
  }
}

export function updateMediaSession(song: Song | null, coverUrl: string | null, playing: boolean): void {
  if (!('mediaSession' in navigator)) return;
  const session = navigator.mediaSession;
  session.playbackState = song ? (playing ? 'playing' : 'paused') : 'none';
  if (!song) {
    session.metadata = null;
    return;
  }
  const artwork = coverUrl && song.cover ? [{ src: coverUrl, type: song.cover.type }] : [];
  session.metadata = new MediaMetadata({ title: song.title, artist: song.artist, album: song.album, artwork });
}
