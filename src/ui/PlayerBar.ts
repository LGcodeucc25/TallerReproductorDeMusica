import type { RepeatMode } from '../core/Playlist';
import type { Song } from '../core/Song';
import type { AudioEngine } from '../services/AudioEngine';
import { byId, formatTime } from './dom';
import { setIcon } from './icons';
import { strings } from './strings';

export interface PlayerBarHandlers {
  onToggle(): void;
  onNext(): void;
  onPrevious(): void;
  onRepeat(): void;
  onShuffle(): void;
  onCover(): void;
  onPanel(): void;
  onFull(): void;
  onVolumeChange(): void;
}

/** Bottom bar, always visible: song, transport, progress, view buttons and volume. */
export class PlayerBar {
  private readonly coverImg = byId<HTMLImageElement>('pb-cover-img');
  private readonly coverEmpty = byId('pb-cover-empty');
  private readonly title = byId('pb-title');
  private readonly artist = byId('pb-artist');
  private readonly seek = byId<HTMLInputElement>('seek');
  private readonly timeCurrent = byId('time-current');
  private readonly timeTotal = byId('time-total');
  private readonly playBtn = byId<HTMLButtonElement>('play-btn');
  private readonly prevBtn = byId<HTMLButtonElement>('prev-btn');
  private readonly nextBtn = byId<HTMLButtonElement>('next-btn');
  private readonly repeatBtn = byId<HTMLButtonElement>('repeat-btn');
  private readonly shuffleBtn = byId<HTMLButtonElement>('shuffle-mode-btn');
  private readonly panelBtn = byId<HTMLButtonElement>('panel-btn');
  private readonly fullBtn = byId<HTMLButtonElement>('full-btn');
  private readonly muteBtn = byId<HTMLButtonElement>('mute-btn');
  private readonly volume = byId<HTMLInputElement>('volume');
  private seeking = false;

  constructor(private readonly engine: AudioEngine, handlers: PlayerBarHandlers) {
    this.playBtn.addEventListener('click', () => handlers.onToggle());
    this.nextBtn.addEventListener('click', () => handlers.onNext());
    this.prevBtn.addEventListener('click', () => handlers.onPrevious());
    this.repeatBtn.addEventListener('click', () => handlers.onRepeat());
    this.shuffleBtn.addEventListener('click', () => handlers.onShuffle());
    byId('pb-cover-btn').addEventListener('click', () => handlers.onCover());
    this.panelBtn.addEventListener('click', () => handlers.onPanel());
    this.fullBtn.addEventListener('click', () => handlers.onFull());

    this.seek.addEventListener('input', () => {
      this.seeking = true;
      this.paintRange(this.seek);
      this.timeCurrent.textContent = formatTime(Number(this.seek.value));
    });
    this.seek.addEventListener('change', () => {
      this.engine.seek(Number(this.seek.value));
      this.seeking = false;
    });

    this.volume.addEventListener('input', () => {
      this.engine.volume = Number(this.volume.value);
      this.renderVolume();
      handlers.onVolumeChange();
    });
    this.muteBtn.addEventListener('click', () => {
      this.engine.muted = !this.engine.muted;
      this.renderVolume();
    });
  }

  renderTrack(song: Song | null, coverUrl: string | null): void {
    this.title.textContent = song ? song.title : strings.nothingPlaying;
    this.artist.textContent = song ? song.artist : '';
    this.coverImg.hidden = !coverUrl;
    this.coverEmpty.hidden = !!coverUrl;
    if (coverUrl) this.coverImg.src = coverUrl;
    else this.coverImg.removeAttribute('src');

    this.seek.disabled = !song;
    if (!song) this.renderProgress(0, 0);
    else if (song.duration && !this.engine.duration) this.renderProgress(this.engine.currentTime, song.duration);
  }

  renderProgress(current: number, duration: number): void {
    if (this.seeking) return;
    this.seek.max = String(duration || 0);
    this.seek.value = String(Math.min(current, duration || 0));
    this.paintRange(this.seek);
    this.timeCurrent.textContent = formatTime(current);
    this.timeTotal.textContent = formatTime(duration);
  }

  renderPlayState(playing: boolean): void {
    document.body.classList.toggle('is-playing', playing);
    setIcon(this.playBtn, playing ? 'pause' : 'play');
    this.playBtn.setAttribute('aria-label', playing ? strings.pause : strings.play);
  }

  renderControls(state: { hasSong: boolean; hasNext: boolean; repeat: RepeatMode; shuffle: boolean }): void {
    this.playBtn.disabled = !state.hasSong;
    this.prevBtn.disabled = !state.hasSong;
    this.nextBtn.disabled = !state.hasSong || !state.hasNext;
    this.repeatBtn.setAttribute('aria-pressed', String(state.repeat !== 'off'));
    this.repeatBtn.setAttribute('aria-label', strings.repeatLabels[state.repeat]);
    this.repeatBtn.title = strings.repeatLabels[state.repeat];
    setIcon(this.repeatBtn, state.repeat === 'one' ? 'repeatOne' : 'repeat');
    const shuffleLabel = strings.shuffleLabel(state.shuffle);
    this.shuffleBtn.setAttribute('aria-pressed', String(state.shuffle));
    this.shuffleBtn.setAttribute('aria-label', shuffleLabel);
    this.shuffleBtn.title = shuffleLabel;
  }

  renderMode(mode: 'mini' | 'panel' | 'full'): void {
    this.panelBtn.setAttribute('aria-pressed', String(mode === 'panel'));
    this.fullBtn.setAttribute('aria-pressed', String(mode === 'full'));
    setIcon(this.fullBtn, mode === 'full' ? 'collapse' : 'expand');
    this.fullBtn.setAttribute('aria-label', mode === 'full' ? strings.exitFullScreen : strings.fullScreen);
  }

  renderVolume(): void {
    const { volume, muted } = this.engine;
    this.volume.value = String(muted ? 0 : volume);
    this.paintRange(this.volume);
    setIcon(this.muteBtn, muted || volume === 0 ? 'mute' : volume < 0.5 ? 'volumeLow' : 'volume');
    this.muteBtn.setAttribute('aria-label', muted ? strings.unmute : strings.mute);
  }

  /** Fills the range track up to the thumb using a CSS custom property. */
  private paintRange(input: HTMLInputElement): void {
    const max = Number(input.max) || 1;
    const ratio = Math.min(1, Math.max(0, Number(input.value) / max));
    input.style.setProperty('--fill', `${ratio * 100}%`);
  }
}
