import { spotifyLog } from './log';

/**
 * Wrapper over the Spotify Web Playback SDK: this browser tab becomes a Spotify
 * Connect device that can play full tracks (Premium only).
 *
 * After every 'ready' the playback is transferred to this device, and nothing is
 * played until that transfer succeeds.
 */

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
/** How long to wait for the 'ready' event before reporting that connect() hangs. */
export const READY_TIMEOUT_MS = 15_000;

export type PlayerErrorReason =
  | 'sdk-load'
  | 'initialization'
  | 'authentication'
  | 'account'
  | 'playback'
  | 'connect'
  | 'timeout'
  | 'transfer';

export type PlayerStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  /** 'ready' arrived and the playback was transferred to this device. */
  | { kind: 'ready'; deviceId: string }
  /** The device went offline ('not_ready'); the SDK may come back with 'ready'. */
  | { kind: 'not-ready'; deviceId: string }
  | { kind: 'error'; reason: PlayerErrorReason; message: string };

export class SpotifyPlayerError extends Error {
  constructor(
    readonly reason: PlayerErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'SpotifyPlayerError';
  }
}

let sdkLoading: Promise<void> | null = null;

/** Loads the SDK script once; resolves when window.Spotify is available. */
export function loadSdk(): Promise<void> {
  sdkLoading ??= new Promise<void>((resolve, reject) => {
    if (window.Spotify) return resolve();
    window.onSpotifyWebPlaybackSDKReady = () => {
      spotifyLog('SDK loaded');
      resolve();
    };
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => {
      sdkLoading = null;
      reject(new SpotifyPlayerError('sdk-load', `Could not load ${SDK_URL}.`));
    };
    document.head.append(script);
  });
  return sdkLoading;
}

export interface SpotifyPlayerOptions {
  getToken: () => Promise<string | null>;
  /** Makes the device the active one (PUT /me/player). */
  transfer: (deviceId: string) => Promise<void>;
  deviceName: string;
  readyTimeoutMs?: number;
}

export class SpotifyPlayer {
  private player: Spotify.Player | null = null;
  private current: PlayerStatus = { kind: 'idle' };
  /** Device of this tab once transferred; kept across playback errors. */
  private readyDeviceId: string | null = null;
  private connecting: Promise<void> | null = null;
  /** The latest transfer, started on each 'ready'. */
  private transferring: Promise<string> | null = null;
  private volume = 0.8;
  private readonly statusListeners = new Set<(status: PlayerStatus) => void>();
  private readonly stateListeners = new Set<(state: Spotify.PlaybackState | null) => void>();

  constructor(private readonly options: SpotifyPlayerOptions) {}

  get status(): PlayerStatus {
    return this.current;
  }

  get deviceId(): string | null {
    return this.readyDeviceId;
  }

  onStatus(listener: (status: PlayerStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onStateChange(listener: (state: Spotify.PlaybackState | null) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /**
   * Loads the SDK, creates the player, waits for 'ready' and for the playback
   * transfer, and resolves with the device id. Safe to call repeatedly.
   */
  async ready(): Promise<string> {
    if (this.readyDeviceId) return this.readyDeviceId;
    if (this.transferring) return this.transferring;
    this.connecting ??= this.doConnect().finally(() => (this.connecting = null));
    await this.connecting;
    return this.transferring ?? Promise.reject(new SpotifyPlayerError('connect', 'The device is not ready.'));
  }

  /** Transfers the playback to this device again (before retrying a failed play request). */
  retransfer(): Promise<string> {
    const deviceId = this.readyDeviceId ?? (this.current.kind === 'not-ready' ? this.current.deviceId : null);
    if (!deviceId) return this.ready();
    return this.startTransfer(deviceId);
  }

  /**
   * Browsers block audio that does not start from a user gesture: call this
   * synchronously inside the click handler, before any await.
   */
  activate(): void {
    if (!this.player) return;
    spotifyLog('activateElement()');
    void this.player.activateElement().catch(() => undefined);
  }

  pause(): Promise<void> {
    return this.player?.pause() ?? Promise.resolve();
  }

  resume(): Promise<void> {
    return this.player?.resume() ?? Promise.resolve();
  }

  seek(positionMs: number): Promise<void> {
    return this.player?.seek(Math.max(0, Math.round(positionMs))) ?? Promise.resolve();
  }

  setVolume(volume: number): Promise<void> {
    this.volume = Math.min(1, Math.max(0, volume));
    return this.player?.setVolume(this.volume) ?? Promise.resolve();
  }

  getCurrentState(): Promise<Spotify.PlaybackState | null> {
    return this.player?.getCurrentState() ?? Promise.resolve(null);
  }

  disconnect(): void {
    this.player?.disconnect();
    this.player = null;
    this.readyDeviceId = null;
    this.transferring = null;
    this.setStatus({ kind: 'idle' });
  }

  /** Resolves once the first 'ready' arrived (the transfer is awaited by ready()). */
  private async doConnect(): Promise<void> {
    this.setStatus({ kind: 'connecting' });
    try {
      await loadSdk();
    } catch (error) {
      this.fail(error as SpotifyPlayerError);
    }

    this.player?.disconnect();
    const player = new window.Spotify!.Player({
      name: this.options.deviceName,
      volume: this.volume,
      getOAuthToken: (callback) => {
        void this.options.getToken().then((token) => {
          if (token) callback(token);
        });
      },
    });
    this.player = player;
    const timeoutMs = this.options.readyTimeoutMs ?? READY_TIMEOUT_MS;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error: SpotifyPlayerError | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const timer = window.setTimeout(() => {
        const error = new SpotifyPlayerError(
          'timeout',
          `The player did not report 'ready' within ${timeoutMs / 1000} s (connect() may be hanging).`,
        );
        spotifyLog(error.message);
        this.setStatus({ kind: 'error', reason: 'timeout', message: error.message });
        settle(error);
      }, timeoutMs);

      player.addListener('ready', ({ device_id }) => {
        spotifyLog('ready, device id:', device_id);
        // Every 'ready' (also after a 'not_ready') needs a new transfer before playing.
        void this.startTransfer(device_id).catch(() => undefined);
        settle(null);
      });
      player.addListener('not_ready', ({ device_id }) => {
        spotifyLog('not_ready, device id:', device_id);
        this.readyDeviceId = null;
        this.transferring = null;
        this.setStatus({ kind: 'not-ready', deviceId: device_id });
      });
      player.addListener('player_state_changed', (state) => {
        const track = state?.track_window.current_track;
        spotifyLog('player_state_changed', { uri: track?.uri ?? null, paused: state?.paused, position: state?.position });
        for (const listener of this.stateListeners) listener(state);
      });

      const errors: [Spotify.ErrorEvent, PlayerErrorReason][] = [
        ['initialization_error', 'initialization'],
        ['authentication_error', 'authentication'],
        ['account_error', 'account'],
        ['playback_error', 'playback'],
      ];
      for (const [event, reason] of errors) {
        player.addListener(event, ({ message }) => {
          spotifyLog(event, message);
          // A playback error does not break the connection; the others stop it.
          if (reason !== 'playback') {
            this.readyDeviceId = null;
            this.transferring = null;
          }
          this.setStatus({ kind: 'error', reason, message });
          if (reason !== 'playback') settle(new SpotifyPlayerError(reason, message));
        });
      }

      void player.connect().then((ok) => {
        spotifyLog('connect() →', ok);
        if (ok) return;
        const message = 'player.connect() returned false.';
        this.setStatus({ kind: 'error', reason: 'connect', message });
        settle(new SpotifyPlayerError('connect', message));
      });
    });
  }

  private startTransfer(deviceId: string): Promise<string> {
    this.readyDeviceId = null;
    this.setStatus({ kind: 'connecting' });
    const transfer = this.options
      .transfer(deviceId)
      .then(() => {
        spotifyLog('transfer to', deviceId, '→ ok');
        if (this.transferring === transfer) {
          this.readyDeviceId = deviceId;
          this.setStatus({ kind: 'ready', deviceId });
        }
        return deviceId;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        spotifyLog('transfer to', deviceId, '→ failed:', message);
        if (this.transferring === transfer) {
          this.transferring = null;
          this.setStatus({ kind: 'error', reason: 'transfer', message });
        }
        throw new SpotifyPlayerError('transfer', message);
      });
    this.transferring = transfer;
    return transfer;
  }

  private fail(error: SpotifyPlayerError): never {
    this.setStatus({ kind: 'error', reason: error.reason, message: error.message });
    throw error;
  }

  private setStatus(status: PlayerStatus): void {
    this.current = status;
    for (const listener of this.statusListeners) listener(status);
  }
}
