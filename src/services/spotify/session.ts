import { SpotifyApi, type SpotifyUser } from './api';
import { SpotifyAuth } from './auth';
import { spotifyLog } from './log';
import { SpotifyPlayer, type PlayerStatus } from './player';

/**
 * Everything Spotify in one place: the login (PKCE), the Web API, the Web Playback
 * SDK device of this tab and the account. The UI subscribes to it.
 */
export class SpotifySession {
  readonly auth: SpotifyAuth | null = null;
  readonly api: SpotifyApi | null = null;
  readonly player: SpotifyPlayer | null = null;
  private account: SpotifyUser | null = null;
  /** Error from the login redirect or from loading the account. */
  private problem: unknown = null;
  private loadingUser = false;
  private readonly listeners = new Set<() => void>();

  /** `clientId` missing means Spotify is not configured; everything stays disabled. */
  constructor(clientId: string | undefined, redirectUri: string, deviceName: string) {
    if (!clientId) return;
    const auth = new SpotifyAuth(clientId, redirectUri);
    const api = new SpotifyApi(auth);
    this.auth = auth;
    this.api = api;
    this.player = new SpotifyPlayer({
      getToken: () => auth.getAccessToken(),
      transfer: (deviceId) => api.transferPlayback(deviceId),
      deviceName,
    });
    this.player.onStatus(() => this.emit());
    auth.subscribe(() => {
      if (auth.isLoggedIn) return;
      this.player?.disconnect();
      this.account = null;
      this.emit();
    });
  }

  get configured(): boolean {
    return this.auth !== null;
  }

  get isLoggedIn(): boolean {
    return !!this.auth?.isLoggedIn;
  }

  get user(): SpotifyUser | null {
    return this.account;
  }

  get isLoadingUser(): boolean {
    return this.loadingUser;
  }

  get isPremium(): boolean {
    return this.account?.product === 'premium';
  }

  /** Spotify songs can play: logged in with a Premium account. */
  get canPlay(): boolean {
    return this.isLoggedIn && this.isPremium;
  }

  get playerStatus(): PlayerStatus {
    return this.player?.status ?? { kind: 'idle' };
  }

  get lastProblem(): unknown {
    return this.problem;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Handles the login redirect, loads the account and, for Premium, connects this tab as a device. */
  async start(): Promise<void> {
    if (!this.auth) return;
    try {
      await this.auth.handleRedirect();
    } catch (error) {
      this.problem = error;
    }
    await this.loadUser();
    if (this.canPlay) void this.player!.ready().catch(() => undefined);
  }

  login(): Promise<void> {
    this.problem = null;
    return this.auth?.login() ?? Promise.resolve();
  }

  logout(): void {
    this.problem = null;
    this.auth?.logout();
  }

  /** Must run synchronously inside a click, before any await (browser autoplay rules). */
  activate(): void {
    this.player?.activate();
  }

  /** Plays one track on this tab's device, waiting for the transfer first and retrying 404/502. */
  async playUri(uri: string, positionMs = 0): Promise<void> {
    const deviceId = await this.player!.ready();
    spotifyLog('play', uri, 'on', deviceId, 'at', positionMs, 'ms');
    await this.api!.playTrack(deviceId, uri, {
      positionMs,
      beforeRetry: async () => {
        await this.player!.retransfer();
      },
    });
  }

  private async loadUser(): Promise<void> {
    if (!this.isLoggedIn) {
      this.emit();
      return;
    }
    this.loadingUser = true;
    this.emit();
    try {
      this.account = await this.api!.getCurrentUser();
      spotifyLog('user', this.account.id, 'product:', this.account.product);
    } catch (error) {
      this.account = null;
      this.problem = error;
    } finally {
      this.loadingUser = false;
      this.emit();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
