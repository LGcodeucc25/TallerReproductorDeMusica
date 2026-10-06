/**
 * Spotify login with Authorization Code + PKCE, entirely in the browser
 * (public client: there is no client secret and no backend).
 *
 * The pure helpers (PKCE and token expiry) have no side effects so they can be tested in Node.
 */

export const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
];

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const TOKENS_KEY = 'spotify-tokens';
const VERIFIER_KEY = 'spotify-pkce-verifier';
const STATE_KEY = 'spotify-pkce-state';

/** Refresh this long before the access token expires. */
export const REFRESH_MARGIN_MS = 60_000;

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds when the access token stops working. */
  expiresAt: number;
}

export type SpotifyAuthErrorKind = 'denied' | 'state-mismatch' | 'token-exchange' | 'refresh-failed';

export class SpotifyAuthError extends Error {
  constructor(
    readonly kind: SpotifyAuthErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'SpotifyAuthError';
  }
}

// ---- Pure helpers (PKCE and token expiry) ----

/** Characters allowed in a PKCE code_verifier (RFC 7636: unreserved characters). */
export const VERIFIER_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** Random code_verifier of `length` characters (43–128), without modulo bias. */
export function createCodeVerifier(length = 64, getRandomValues = (bytes: Uint8Array) => crypto.getRandomValues(bytes)): string {
  if (length < 43 || length > 128) throw new RangeError('A PKCE code verifier must have 43 to 128 characters.');
  const size = VERIFIER_CHARSET.length; // 66
  const limit = 256 - (256 % size); // reject bytes above the last full multiple of 66
  let result = '';
  while (result.length < length) {
    for (const byte of getRandomValues(new Uint8Array(length))) {
      if (byte < limit && result.length < length) result += VERIFIER_CHARSET[byte % size];
    }
  }
  return result;
}

/** Base64url without padding (RFC 4648 §5). */
export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** code_challenge = base64url(SHA-256(code_verifier)). */
export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Random value for the OAuth `state` parameter. */
export function createState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export function expiresAtFrom(expiresInSeconds: number, now: number): number {
  return now + expiresInSeconds * 1000;
}

/** Whether the access token is expired or about to expire within `margin`. */
export function needsRefresh(tokens: Pick<SpotifyTokens, 'expiresAt'>, now: number, margin = REFRESH_MARGIN_MS): boolean {
  return now >= tokens.expiresAt - margin;
}

/** Milliseconds to wait before refreshing proactively (0 when it is already due). */
export function refreshDelay(tokens: Pick<SpotifyTokens, 'expiresAt'>, now: number, margin = REFRESH_MARGIN_MS): number {
  return Math.max(0, tokens.expiresAt - margin - now);
}

// ---- Browser flow ----

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/**
 * Holds the tokens (localStorage), handles the login redirect and refreshes the
 * access token automatically before it expires.
 */
export class SpotifyAuth {
  private tokens: SpotifyTokens | null;
  private refreshing: Promise<string> | null = null;
  private refreshTimer = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly clientId: string,
    private readonly redirectUri: string,
  ) {
    this.tokens = readTokens();
    this.scheduleRefresh();
  }

  get isLoggedIn(): boolean {
    return this.tokens !== null;
  }

  /** Called when the user logs in or out (also after a failed refresh). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Redirects to Spotify's consent page. */
  async login(): Promise<void> {
    const verifier = createCodeVerifier();
    const state = createState();
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: SPOTIFY_SCOPES.join(' '),
      redirect_uri: this.redirectUri,
      code_challenge_method: 'S256',
      code_challenge: await createCodeChallenge(verifier),
      state,
    });
    window.location.assign(`${AUTHORIZE_URL}?${params}`);
  }

  /**
   * Handles the return from Spotify (?code=…&state=… or ?error=…) on page load,
   * then removes those parameters from the URL. Returns true if it logged in.
   */
  async handleRedirect(): Promise<boolean> {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (!code && !error) return false;

    const returnedState = url.searchParams.get('state');
    const expectedState = sessionStorage.getItem(STATE_KEY);
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
    for (const key of ['code', 'state', 'error']) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);

    if (error) throw new SpotifyAuthError('denied', `Spotify returned "${error}".`);
    if (!returnedState || returnedState !== expectedState || !verifier) {
      throw new SpotifyAuthError('state-mismatch', 'The login response does not match the request (state check failed).');
    }

    const response = await this.requestToken({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: verifier,
    });
    if (!response.refresh_token) throw new SpotifyAuthError('token-exchange', 'Spotify did not return a refresh token.');
    this.store(response, response.refresh_token);
    return true;
  }

  /** A valid access token, refreshed first if it is about to expire. Null when logged out. */
  async getAccessToken(): Promise<string | null> {
    if (!this.tokens) return null;
    if (!needsRefresh(this.tokens, Date.now())) return this.tokens.accessToken;
    return this.refresh();
  }

  /** Gets a new access token with the refresh token. Concurrent calls share one request. */
  refresh(): Promise<string> {
    this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  logout(): void {
    window.clearTimeout(this.refreshTimer);
    this.tokens = null;
    localStorage.removeItem(TOKENS_KEY);
    this.emit();
  }

  private async doRefresh(): Promise<string> {
    const current = this.tokens;
    if (!current) throw new SpotifyAuthError('refresh-failed', 'Not logged in to Spotify.');
    try {
      const response = await this.requestToken({
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
        client_id: this.clientId,
      });
      // Spotify may rotate the refresh token; keep the old one when it does not.
      this.store(response, response.refresh_token ?? current.refreshToken);
      return this.tokens!.accessToken;
    } catch (error) {
      // A network failure keeps the session (it can be retried); a rejected refresh token ends it.
      if (!(error instanceof SpotifyAuthError)) throw error;
      this.logout();
      throw new SpotifyAuthError('refresh-failed', error.message);
    }
  }

  private async requestToken(body: Record<string, string>): Promise<TokenResponse> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    const data = (await response.json().catch(() => ({}))) as Partial<TokenResponse> & {
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !data.access_token || !data.expires_in) {
      const detail = data.error_description || data.error || `HTTP ${response.status}`;
      throw new SpotifyAuthError('token-exchange', `Token request failed: ${detail}.`);
    }
    return data as TokenResponse;
  }

  private store(response: TokenResponse, refreshToken: string): void {
    this.tokens = {
      accessToken: response.access_token,
      refreshToken,
      expiresAt: expiresAtFrom(response.expires_in, Date.now()),
    };
    localStorage.setItem(TOKENS_KEY, JSON.stringify(this.tokens));
    this.scheduleRefresh();
    this.emit();
  }

  /** Refreshes in the background shortly before expiry, so playback never meets an expired token. */
  private scheduleRefresh(): void {
    window.clearTimeout(this.refreshTimer);
    if (!this.tokens) return;
    this.refreshTimer = window.setTimeout(() => void this.refresh().catch(() => undefined), refreshDelay(this.tokens, Date.now()));
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function readTokens(): SpotifyTokens | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? 'null') as SpotifyTokens | null;
    return parsed?.accessToken && parsed.refreshToken && Number.isFinite(parsed.expiresAt) ? parsed : null;
  } catch {
    return null;
  }
}
