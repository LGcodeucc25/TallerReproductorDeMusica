import type { RepeatMode } from '../core/Playlist';
import type { Song } from '../core/Song';
import { formatCounter } from './dom';
import { setIcon } from './icons';
import { strings } from './strings';

export interface TransportHandlers {
  onToggle(): void;
  onNext(): void;
  onPrevious(): void;
  onRepeat(): void;
  onShuffle(): void;
  onSeek(seconds: number): void;
  onVolume(volume: number): void;
  onToggleMute(): void;
}

export interface TransportControlsState {
  hasSong: boolean;
  hasNext: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
}

/**
 * The deck keys, tape counters, progress bars and volume, wherever they appear
 * (stage, minimized dock and lyrics deck). Every instance is found by its data
 * attribute and kept in sync; it works with any playback engine.
 */
export class Transport {
  private readonly keys = (name: string) => document.querySelectorAll<HTMLButtonElement>(`[data-transport="${name}"]`);
  private readonly seeks = Array.from(document.querySelectorAll<HTMLInputElement>('[data-seek]'));
  private readonly volumes = Array.from(document.querySelectorAll<HTMLInputElement>('[data-volume]'));
  private readonly mutes = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-mute]'));
  /** The progress bar being dragged keeps its value until released. */
  private seeking: HTMLInputElement | null = null;

  constructor(handlers: TransportHandlers) {
    document.addEventListener('click', (event) => {
      const key = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-transport]');
      if (!key || key.disabled) return;
      const action = key.dataset.transport;
      if (action === 'toggle') handlers.onToggle();
      else if (action === 'next') handlers.onNext();
      else if (action === 'previous') handlers.onPrevious();
      else if (action === 'repeat') handlers.onRepeat();
      else if (action === 'shuffle') handlers.onShuffle();
    });

    for (const seek of this.seeks) {
      seek.addEventListener('input', () => {
        this.seeking = seek;
        this.paint(seek);
        this.setCounters('current', Number(seek.value));
      });
      seek.addEventListener('change', () => {
        this.seeking = null;
        handlers.onSeek(Number(seek.value));
      });
    }
    for (const volume of this.volumes) volume.addEventListener('input', () => handlers.onVolume(Number(volume.value)));
    for (const mute of this.mutes) mute.addEventListener('click', () => handlers.onToggleMute());
  }

  /** Title, artist and album wherever they are shown. */
  renderTrack(song: Song | null): void {
    this.setText('title', song ? song.title : strings.nothingPlaying);
    this.setText('artist', song ? song.artist : strings.getStarted);
    this.setText('album', song?.album ?? '');
    for (const seek of this.seeks) seek.disabled = !song;
  }

  renderProgress(current: number, duration: number): void {
    for (const seek of this.seeks) {
      if (seek === this.seeking) continue;
      seek.max = String(duration || 0);
      seek.value = String(Math.min(current, duration || 0));
      seek.setAttribute('aria-valuetext', `${formatCounter(current)} / ${formatCounter(duration)}`);
      this.paint(seek);
    }
    if (!this.seeking) this.setCounters('current', current);
    this.setCounters('total', duration);
  }

  renderPlayState(playing: boolean): void {
    document.body.classList.toggle('is-playing', playing);
    for (const key of this.keys('toggle')) {
      setIcon(key, playing ? 'pause' : 'play');
      key.setAttribute('aria-label', playing ? strings.pause : strings.play);
    }
  }

  renderControls(state: TransportControlsState): void {
    for (const key of this.keys('toggle')) key.disabled = !state.hasSong;
    for (const key of this.keys('previous')) key.disabled = !state.hasSong;
    for (const key of this.keys('next')) key.disabled = !state.hasSong || !state.hasNext;
    for (const key of this.keys('repeat')) {
      key.setAttribute('aria-pressed', String(state.repeat !== 'off'));
      key.setAttribute('aria-label', strings.repeatLabels[state.repeat]);
      key.title = strings.repeatLabels[state.repeat];
      setIcon(key, state.repeat === 'one' ? 'repeatOne' : 'repeat');
    }
    const shuffleLabel = strings.shuffleLabel(state.shuffle);
    for (const key of this.keys('shuffle')) {
      key.setAttribute('aria-pressed', String(state.shuffle));
      key.setAttribute('aria-label', shuffleLabel);
      key.title = shuffleLabel;
    }
  }

  renderVolume(volume: number, muted: boolean): void {
    for (const input of this.volumes) {
      input.value = String(muted ? 0 : volume);
      this.paint(input);
    }
    for (const mute of this.mutes) {
      setIcon(mute, muted || volume === 0 ? 'mute' : volume < 0.5 ? 'volumeLow' : 'volume');
      mute.setAttribute('aria-label', muted ? strings.unmute : strings.mute);
    }
  }

  private setText(field: string, text: string): void {
    for (const element of document.querySelectorAll<HTMLElement>(`[data-track="${field}"]`)) element.textContent = text;
  }

  private setCounters(kind: 'current' | 'total', seconds: number): void {
    for (const counter of document.querySelectorAll<HTMLElement>(`[data-time="${kind}"]`)) counter.textContent = formatCounter(seconds);
  }

  /** Fills the range up to the thumb using a CSS custom property. */
  private paint(input: HTMLInputElement): void {
    const max = Number(input.max) || 1;
    const ratio = Math.min(1, Math.max(0, Number(input.value) / max));
    input.style.setProperty('--fill', `${ratio * 100}%`);
  }
}
