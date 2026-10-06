import { spotifySongId, type SpotifySong } from '../../core/Song';
import type { SpotifyTrack } from './api';

/** Turns a Web API track into a song of the app (metadata only; Spotify streams the audio). */
export function songFromTrack(track: SpotifyTrack, addedAt = Date.now()): SpotifySong {
  // Album images come largest first; ~300 px is enough for rows and the player.
  const images = track.album.images;
  const cover = images.find((image) => (image.width ?? 0) <= 320) ?? images[images.length - 1] ?? images[0];
  return {
    source: 'spotify',
    id: spotifySongId(track.id),
    spotifyId: track.id,
    spotifyUri: track.uri,
    title: track.name,
    artist: track.artists.map((artist) => artist.name).join(', '),
    album: track.album.name,
    duration: Math.round(track.duration_ms / 1000),
    coverUrl: cover?.url ?? null,
    externalUrl: track.external_urls.spotify ?? `https://open.spotify.com/track/${track.id}`,
    addedAt,
  };
}
