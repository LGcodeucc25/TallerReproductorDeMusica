/**
 * Minimal type declarations for the Spotify Web Playback SDK
 * (https://developer.spotify.com/documentation/web-playback-sdk/reference),
 * covering only what this app uses.
 */

declare namespace Spotify {
  interface Error {
    message: string;
  }

  interface WebPlaybackInstance {
    device_id: string;
  }

  interface Image {
    url: string;
    height?: number | null;
    width?: number | null;
  }

  interface Track {
    uri: string;
    id: string | null;
    name: string;
    duration_ms: number;
    artists: { name: string; uri: string }[];
    album: { name: string; uri: string; images: Image[] };
    /** Set when Spotify plays a relinked version of the requested track (other market). */
    linked_from?: { uri: string | null; id: string | null };
  }

  interface PlaybackState {
    paused: boolean;
    position: number;
    duration: number;
    track_window: {
      current_track: Track | null;
      previous_tracks: Track[];
      next_tracks: Track[];
    };
  }

  interface PlayerInit {
    name: string;
    getOAuthToken(callback: (token: string) => void): void;
    volume?: number;
  }

  type ErrorEvent = 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error';

  class Player {
    constructor(options: PlayerInit);
    connect(): Promise<boolean>;
    disconnect(): void;
    activateElement(): Promise<void>;
    getCurrentState(): Promise<PlaybackState | null>;
    togglePlay(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    setVolume(volume: number): Promise<void>;

    addListener(event: 'ready' | 'not_ready', callback: (instance: WebPlaybackInstance) => void): boolean;
    addListener(event: 'player_state_changed', callback: (state: PlaybackState | null) => void): boolean;
    addListener(event: ErrorEvent, callback: (error: Error) => void): boolean;
    removeListener(event: string): boolean;
  }
}

interface Window {
  Spotify?: typeof Spotify;
  onSpotifyWebPlaybackSDKReady?: () => void;
}
