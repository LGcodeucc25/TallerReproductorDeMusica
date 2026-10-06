import type { SpotifyAuth } from './auth';
import { spotifyLog } from './log';

const API_BASE = 'https://api.spotify.com/v1';
/** Development Mode returns at most 10 search results. */
export const SEARCH_LIMIT = 10;
/** Longest Retry-After (seconds) worth waiting for before retrying once. */
const MAX_RETRY_WAIT_S = 10;
/** Play requests that fail with these statuses (device not found yet, bad gateway) are retried. */
const PLAY_RETRY_STATUSES = new Set([404, 502]);
export const PLAY_RETRIES = 3;
const PLAY_RETRY_DELAY_MS = 500;

export interface SpotifyUser {
  id: string;
  display_name: string | null;
  email?: string;
  /** "premium", "free" or "open". */
  product?: string;
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album: { name: string; images: { url: string; width: number | null; height: number | null }[] };
  external_urls: { spotify?: string };
}

export type SpotifyApiErrorKind =
  /** No session, or the token was rejected even after refreshing. */
  | 'unauthorized'
  /** 403: the user is not in the app's allowlist (User Management) or is not Premium. */
  | 'forbidden'
  /** 429: too many requests; `retryAfter` says how many seconds to wait. */
  | 'rate-limited'
  /** 404 on the player endpoints: the device is not available. */
  | 'not-found'
  | 'http';

export class SpotifyApiError extends Error {
  constructor(
    readonly kind: SpotifyApiErrorKind,
    readonly status: number,
    message: string,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

/** Small typed wrapper over the Spotify Web API with the user's bearer token. */
export class SpotifyApi {
  constructor(
    private readonly auth: SpotifyAuth,
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  /** GET /me. The SDK can only play for Premium accounts (`product === 'premium'`). */
  getCurrentUser(): Promise<SpotifyUser> {
    return this.request<SpotifyUser>('GET', '/me') as Promise<SpotifyUser>;
  }

  async searchTracks(query: string): Promise<SpotifyTrack[]> {
    const params = new URLSearchParams({ q: query, type: 'track', limit: String(SEARCH_LIMIT) });
    const result = await this.request<{ tracks: { items: (SpotifyTrack | null)[] } }>('GET', `/search?${params}`);
    return (result?.tracks.items ?? []).filter((track): track is SpotifyTrack => !!track);
  }

  /** Makes the given device (this tab) the active Spotify Connect device, without starting playback. */
  async transferPlayback(deviceId: string): Promise<void> {
    await this.request('PUT', '/me/player', { device_ids: [deviceId], play: false });
  }

  /**
   * Plays exactly one track on the device (our queue decides what comes next).
   * A 404 (device not found yet) or 502 is retried up to PLAY_RETRIES times,
   * 500 ms apart, calling `beforeRetry` (a new playback transfer) before each retry.
   */
  async playTrack(
    deviceId: string,
    uri: string,
    options: { positionMs?: number; beforeRetry?: () => Promise<void> } = {},
  ): Promise<void> {
    const body = { uris: [uri], position_ms: Math.max(0, Math.round(options.positionMs ?? 0)) };
    for (let attempt = 0; ; attempt++) {
      try {
        await this.request('PUT', `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, body);
        return;
      } catch (error) {
        const retryable = error instanceof SpotifyApiError && PLAY_RETRY_STATUSES.has(error.status);
        if (!retryable || attempt >= PLAY_RETRIES) throw error;
        spotifyLog(`play failed with ${error.status}; retry ${attempt + 1}/${PLAY_RETRIES} in ${PLAY_RETRY_DELAY_MS} ms`);
        await new Promise((resolve) => setTimeout(resolve, PLAY_RETRY_DELAY_MS));
        await options.beforeRetry?.();
      }
    }
  }

  /** `attempt`: 0 = first try, 1 = retry after a 401 (with a refreshed token), 2 = retry after a 429. */
  private async request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T | null> {
    const token = attempt === 1 ? await this.auth.refresh().catch(() => null) : await this.auth.getAccessToken();
    if (!token) throw new SpotifyApiError('unauthorized', 401, 'Not logged in to Spotify.');

    const response = await this.fetchFn(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    spotifyLog(`${method} ${path.split('?')[0]} → ${response.status}`);

    if (response.status === 401 && attempt === 0) return this.request<T>(method, path, body, 1);
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After')) || 1;
      if (attempt < 2 && retryAfter <= MAX_RETRY_WAIT_S) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        return this.request<T>(method, path, body, 2);
      }
      throw new SpotifyApiError('rate-limited', 429, `Too many requests to Spotify. Retry after ${retryAfter} s.`, retryAfter);
    }
    if (response.status === 204 || response.status === 202) return null;

    const data = (await response.json().catch(() => null)) as ({ error?: { message?: string } } & T) | null;
    if (!response.ok) {
      const detail = data?.error?.message || response.statusText || 'Unknown error';
      throw new SpotifyApiError(errorKind(response.status), response.status, `Spotify API ${response.status}: ${detail}`);
    }
    return data;
  }
}

function errorKind(status: number): SpotifyApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  return 'http';
}
