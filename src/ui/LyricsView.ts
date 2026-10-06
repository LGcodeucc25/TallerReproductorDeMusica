import { activeLineIndex, parseLrc, toDisplayLines, type DisplayLine } from '../core/lyrics';
import type { LyricsContent } from '../services/lyrics/lrclib';
import { create, formatCounter, prefersReducedMotion } from './dom';
import { strings } from './strings';

export type LyricsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'content'; content: LyricsContent };

export interface LyricsHandlers {
  onSeek(seconds: number): void;
  onRetry(): void;
}

/**
 * Karaoke-style synced lyrics: the active line is bright, past lines dimmed and
 * upcoming ones muted. It follows the song by scrolling the active line to the
 * upper third, until the user scrolls by hand. Used in the main panel and in the
 * full-screen view; the time comes from whichever engine is playing.
 */
export class LyricsView {
  private readonly list = create('ol', 'lyrics-lines');
  private readonly message = create('div', 'lyrics-message');
  private readonly backBtn = create('button', 'pill pill--outline lyrics-back', strings.lyrics.backToCurrent);
  private lines: DisplayLine[] = [];
  private items: HTMLElement[] = [];
  private active = -2;
  private following = true;
  private visible = false;
  private frame = 0;
  private renderedKey = '';

  constructor(
    private readonly root: HTMLElement,
    /** The element that scrolls (the main panel, or the lyrics column itself in full screen). */
    private readonly scroller: HTMLElement,
    handlers: LyricsHandlers,
    private readonly getTimeMs: () => number,
  ) {
    const head = create('div', 'lyrics-head');
    head.append(create('span', 'tape-label tape-label--mint', strings.lyrics.syncedLabel), create('span', 'lyrics-head-spacer'), this.backBtn);
    const credit = create('p', 'lyrics-credit');
    const link = create('a', '', strings.lyrics.attribution);
    link.href = 'https://lrclib.net';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    credit.append(link, ` ${strings.lyrics.hint}`);
    this.backBtn.type = 'button';
    this.backBtn.hidden = true;
    root.append(head, this.message, this.list, credit);

    this.list.addEventListener('click', (event) => {
      const line = (event.target as HTMLElement).closest<HTMLElement>('[data-time]');
      if (!line) return;
      this.follow();
      handlers.onSeek(Number(line.dataset.time) / 1000);
    });
    this.message.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-retry]')) handlers.onRetry();
    });
    this.backBtn.addEventListener('click', () => this.follow());

    // Scrolling by hand stops following; programmatic scrolls do not fire these.
    const stopFollowing = () => {
      if (!this.visible || this.lines.length === 0 || !this.following) return;
      this.following = false;
      this.backBtn.hidden = false;
    };
    scroller.addEventListener('wheel', stopFollowing, { passive: true });
    scroller.addEventListener('touchmove', stopFollowing, { passive: true });
    scroller.addEventListener('keydown', (event) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) stopFollowing();
    });
  }

  setVisible(visible: boolean): void {
    // Called on every view change: only a real change (re)starts or stops the follow loop.
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) {
      this.active = -2;
      this.follow();
      this.loop();
    } else {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  /** `key` identifies the song: the lines are rebuilt only when it or the state changes. */
  render(key: string, state: LyricsState): void {
    const renderKey = `${key}|${state.kind}`;
    if (renderKey === this.renderedKey) return;
    this.renderedKey = renderKey;
    this.lines = [];
    this.items = [];
    this.active = -2;
    this.list.replaceChildren();
    this.message.replaceChildren();
    this.root.dataset.kind = state.kind === 'content' ? state.content.kind : state.kind;

    if (state.kind === 'idle') return this.showMessage(strings.lyrics.nothingPlaying);
    if (state.kind === 'loading') return this.showMessage(strings.lyrics.loading);
    if (state.kind === 'error') return this.showMessage(strings.lyrics.error, true);

    const content = state.content;
    if (content.kind === 'not-found') return this.showMessage(strings.lyrics.notFound);
    if (content.kind === 'instrumental') return this.showMessage(strings.lyrics.instrumental);
    if (content.kind === 'plain') {
      this.showMessage(strings.lyrics.notSynced);
      for (const text of content.text.split(/\r?\n/)) this.list.append(create('li', 'lyrics-line lyrics-line--plain', text || ' '));
      return;
    }

    this.lines = toDisplayLines(parseLrc(content.lrc));
    if (this.lines.length === 0) return this.showMessage(strings.lyrics.notFound);
    this.items = this.lines.map((line) => {
      const li = create('li');
      const button = create('button', `lyrics-line${line.interlude ? ' lyrics-line--interlude' : ''}`);
      button.type = 'button';
      button.dataset.time = String(line.timeMs);
      const time = create('span', 'lyrics-time', formatCounter(line.timeMs / 1000));
      time.setAttribute('aria-hidden', 'true');
      if (line.interlude) {
        button.append(time, create('span', 'lyrics-dots', strings.lyrics.interlude));
      } else {
        button.append(time, create('span', 'lyrics-text', line.text));
        button.setAttribute('aria-label', strings.lyrics.seekTo(line.text));
      }
      li.append(button);
      this.list.append(li);
      return button;
    });
    this.follow();
  }

  private showMessage(text: string, retry = false): void {
    this.message.replaceChildren(create('p', '', text));
    if (retry) {
      const button = create('button', 'btn btn--ghost btn--sm', strings.lyrics.retry);
      button.type = 'button';
      button.dataset.retry = 'true';
      this.message.append(button);
    }
  }

  private follow(): void {
    this.following = true;
    this.backBtn.hidden = true;
    this.active = -2; // forces a scroll on the next frame
    if (this.visible) this.update(true);
  }

  private loop = (): void => {
    this.frame = 0;
    if (!this.visible) return;
    this.update(false);
    this.frame = requestAnimationFrame(this.loop);
  };

  private update(force: boolean): void {
    if (this.lines.length === 0) return;
    const index = activeLineIndex(this.lines, this.getTimeMs());
    if (index === this.active && !force) return;
    const changed = index !== this.active;
    this.active = index;
    if (changed) {
      this.items.forEach((item, i) => {
        item.classList.toggle('is-past', i < index);
        item.classList.toggle('is-active', i === index);
        if (i === index) item.setAttribute('aria-current', 'true');
        else item.removeAttribute('aria-current');
      });
    }
    if (this.following) this.scrollToActive();
  }

  /** Keeps the active line around the upper third of the visible area. */
  private scrollToActive(): void {
    const item = this.items[Math.max(0, this.active)];
    if (!item) return;
    const offset = item.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop;
    const top = Math.max(0, offset - this.scroller.clientHeight / 3);
    this.scroller.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
}
