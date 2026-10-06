import { SpotifyApiError } from '../services/spotify/api';
import { SpotifyAuthError } from '../services/spotify/auth';
import { SpotifyPlayerError, type PlayerStatus } from '../services/spotify/player';
import type { SpotifySession } from '../services/spotify/session';
import { byId } from './dom';
import { strings } from './strings';

/**
 * Spotify in the interface: the box at the bottom of the shelf (connection state,
 * the user's name, connect / disconnect) and the chip in the top bar.
 * Searching happens in the main search bar.
 */
export class SpotifyPanel {
  private readonly chip = byId<HTMLButtonElement>('spotify-chip');
  private readonly chipLabel = byId('spotify-chip-label');
  private readonly box = byId('spotify-box');
  private readonly connectBtn = byId<HTMLButtonElement>('spotify-connect-btn');
  private readonly logoutBtn = byId<HTMLButtonElement>('spotify-logout-btn');
  private readonly userText = byId('spotify-user');
  private readonly note = byId('spotify-note');
  /** Error of a failed login attempt. */
  private loginError: string | null = null;

  /** `onShowBox`: the chip of a connected account opens the library with the Spotify box. */
  constructor(
    private readonly session: SpotifySession,
    onShowBox: () => void,
  ) {
    this.chip.addEventListener('click', () => {
      if (this.session.isLoggedIn) {
        onShowBox();
        this.box.scrollIntoView({ block: 'nearest' });
      } else {
        this.connect();
      }
    });
    this.connectBtn.addEventListener('click', () => this.connect());
    this.logoutBtn.addEventListener('click', () => session.logout());
    session.subscribe(() => this.render());
    this.render();
  }

  /** Starts the Spotify login (also used by the search view's connect card). */
  connect(): void {
    if (!this.session.configured) return;
    this.loginError = null;
    this.connectBtn.disabled = true;
    this.setNote(strings.spotify.redirecting, false);
    this.session.login().catch((error) => {
      this.loginError = describeSpotifyError(error);
      this.render();
    });
  }

  private render(): void {
    const session = this.session;
    this.renderChip();
    if (!session.configured) {
      this.connectBtn.disabled = true;
      this.logoutBtn.hidden = true;
      this.userText.hidden = true;
      this.setNote(strings.spotify.notConfigured, false);
      return;
    }
    const loggedIn = session.isLoggedIn;
    this.connectBtn.hidden = loggedIn;
    this.connectBtn.disabled = false;
    this.logoutBtn.hidden = !loggedIn;
    this.userText.hidden = !session.user;
    this.userText.textContent = session.user ? strings.spotify.connectedAs(session.user.display_name || session.user.id) : '';

    const problem = this.loginError ?? (session.lastProblem ? describeSpotifyError(session.lastProblem) : null);
    if (problem) return this.setNote(problem, true);
    if (!loggedIn) return this.setNote(null, false);
    if (session.isLoadingUser) return this.setNote(strings.spotify.loadingUser, false);
    if (session.user && !session.isPremium) return this.setNote(strings.spotify.notPremium, false);
    const status = session.playerStatus;
    this.setNote(playerStatusText(status), status.kind === 'error');
  }

  private renderChip(): void {
    const session = this.session;
    this.chip.hidden = !session.configured;
    const connected = session.isLoggedIn && !!session.user;
    this.chip.classList.toggle('is-connected', connected);
    this.box.classList.toggle('is-connected', connected);
    this.chipLabel.textContent = connected
      ? strings.spotify.chip(session.user!.display_name || session.user!.id)
      : session.isLoggedIn
        ? strings.spotify.loadingUser
        : strings.spotify.chipConnect;
  }

  private setNote(text: string | null, isError: boolean): void {
    this.note.hidden = !text;
    this.note.textContent = text ?? '';
    this.note.dataset.kind = isError ? 'error' : 'info';
  }
}

function playerStatusText(status: PlayerStatus): string | null {
  switch (status.kind) {
    case 'connecting':
      return strings.spotify.connecting;
    case 'ready':
      return strings.spotify.ready;
    case 'not-ready':
      return strings.spotify.reconnecting;
    case 'error':
      return strings.spotify.playerError(strings.spotify.errorReasons[status.reason], status.message);
    default:
      return null;
  }
}

/** Spanish message for any error from the Spotify services, keeping Spotify's exact text. */
export function describeSpotifyError(error: unknown): string {
  if (error instanceof SpotifyApiError) {
    if (error.kind === 'forbidden') return strings.spotify.forbidden(error.message);
    if (error.kind === 'rate-limited') return strings.spotify.rateLimited(error.retryAfter);
    if (error.kind === 'unauthorized') return strings.spotify.sessionExpired;
    if (error.kind === 'not-found') return strings.spotify.deviceMissing(error.message);
    return strings.spotify.genericError(error.message);
  }
  if (error instanceof SpotifyAuthError) {
    if (error.kind === 'denied') return strings.spotify.loginDenied;
    if (error.kind === 'state-mismatch') return strings.spotify.stateMismatch;
    if (error.kind === 'refresh-failed') return strings.spotify.sessionExpired;
    return strings.spotify.loginFailed(error.message);
  }
  if (error instanceof SpotifyPlayerError) {
    return strings.spotify.playerError(strings.spotify.errorReasons[error.reason], error.message);
  }
  return strings.spotify.genericError(error instanceof Error ? error.message : String(error));
}
