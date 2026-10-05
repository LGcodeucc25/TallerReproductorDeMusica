import type { PlaybackQueue } from '../core/PlaybackQueue';
import type { RepeatMode } from '../core/Playlist';
import type { CoverCache } from './CoverCache';
import { byId, create, formatTime } from './dom';
import { icons, setIcon } from './icons';
import { SONG_DRAG_TYPE } from './SidebarView';
import { strings } from './strings';

export type PlayerMode = 'mini' | 'panel' | 'full';

export const STAGE_MIN = 280;
export const STAGE_DEFAULT = 360;
const STAGE_MAX = 640;
const COLLAPSE_BELOW = 210;
/** Songs shown in the up-next list; the rest are summarized as a count. */
const UPNEXT_LIMIT = 30;

export interface StageHandlers {
  onModeRequest(mode: PlayerMode | 'docked'): void;
  onResize(width: number): void;
  onPickUpcoming(songId: string): void;
  /** A queued song was dropped before or after another one (changes the queue only). */
  onMoveUpcoming(songId: string, refSongId: string, where: 'before' | 'after'): void;
}

/**
 * "Now playing" view. The same element is a resizable side panel or a
 * full-screen view, depending on data-player-mode on <body>.
 */
export class StageView {
  private readonly app = byId('app');
  private readonly handle = byId('stage-resize');
  private readonly source = byId('stage-source');
  private readonly coverImg = byId<HTMLImageElement>('cover-img');
  private readonly coverEmpty = byId('cover-empty');
  private readonly title = byId('track-title');
  private readonly artist = byId('track-artist');
  private readonly prev = byId('neighbor-prev');
  private readonly next = byId('neighbor-next');
  private readonly upnext = byId<HTMLOListElement>('upnext-list');
  private readonly fullBtn = byId<HTMLButtonElement>('stage-full-btn');
  private width = STAGE_DEFAULT;
  /** Song being dragged inside the up-next list. */
  private dragSongId: string | null = null;

  constructor(private readonly handlers: StageHandlers) {
    this.fullBtn.addEventListener('click', () =>
      handlers.onModeRequest(document.body.dataset.playerMode === 'full' ? 'docked' : 'full'),
    );
    byId('stage-close-btn').addEventListener('click', () =>
      handlers.onModeRequest(document.body.dataset.playerMode === 'full' ? 'docked' : 'mini'),
    );
    this.upnext.addEventListener('click', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('[data-song-id]');
      if (item?.dataset.songId) handlers.onPickUpcoming(item.dataset.songId);
    });
    this.bindUpnextDrag();
    this.bindResize();
    window.addEventListener('resize', () => this.setWidth(this.width));

    // The full-screen view sits above the player bar, whose height varies by screen.
    const bar = document.querySelector<HTMLElement>('.playerbar')!;
    new ResizeObserver(() =>
      document.documentElement.style.setProperty('--bar-h', `${Math.round(bar.getBoundingClientRect().height)}px`),
    ).observe(bar);
  }

  get currentWidth(): number {
    return this.width;
  }

  setWidth(width: number): void {
    const max = Math.max(STAGE_MIN, Math.min(STAGE_MAX, Math.round(window.innerWidth * 0.45)));
    this.width = Math.round(Math.min(max, Math.max(STAGE_MIN, width)));
    this.app.style.setProperty('--stage-w', `${this.width}px`);
    this.handle.setAttribute('aria-valuenow', String(this.width));
    this.handle.setAttribute('aria-valuemax', String(max));
    this.app.classList.toggle('stage-wide', this.width >= 480);
  }

  renderMode(mode: PlayerMode): void {
    setIcon(this.fullBtn, mode === 'full' ? 'collapse' : 'expand');
    this.fullBtn.setAttribute('aria-label', mode === 'full' ? strings.exitFullScreen : strings.fullScreen);
  }

  /** Draws the playback queue (not a playlist): current song, its neighbours and what comes next. */
  render(queue: PlaybackQueue, sourceName: string | null, repeat: RepeatMode, covers: CoverCache): void {
    const song = queue.current;
    const coverUrl = covers.get(song);

    this.source.textContent = song && sourceName ? strings.stage.playingFrom(sourceName) : strings.nothingPlaying;
    this.title.textContent = song ? song.title : strings.nothingPlaying;
    this.artist.textContent = song ? [song.artist, song.album].filter(Boolean).join(', ') : strings.getStarted;

    this.coverImg.hidden = !coverUrl;
    this.coverEmpty.hidden = !!coverUrl;
    byId('stage').style.setProperty('--cover-url', coverUrl ? `url("${coverUrl}")` : 'none');
    if (coverUrl) {
      this.coverImg.src = coverUrl;
      this.coverImg.alt = strings.coverOf(song?.album || song?.title || '');
    } else {
      this.coverImg.removeAttribute('src');
    }

    // The songs that previous and next would actually play, wrapping when repeat is on.
    const previous = queue.peekPrevious(repeat);
    const following = queue.peekNext(repeat);
    this.prev.textContent = previous?.title ?? strings.stage.nothing;
    this.next.textContent = following?.title ?? strings.stage.nothing;
    this.prev.classList.toggle('is-empty', !previous);
    this.next.classList.toggle('is-empty', !following);

    const items = queue.upcoming(UPNEXT_LIMIT, repeat);
    const fragment = document.createDocumentFragment();
    for (const upcoming of items) {
      const li = create('li');
      const button = create('button', 'upnext-item');
      button.type = 'button';
      button.dataset.songId = upcoming.id;
      button.draggable = true;
      button.setAttribute('aria-label', strings.playSong(upcoming.title));
      button.title = strings.stage.upnextHint;
      const grip = create('span', 'upnext-grip');
      grip.innerHTML = icons.grip;
      const url = covers.get(upcoming);
      const thumb = url ? create('img', 'upnext-cover') : create('span', 'upnext-cover upnext-cover--empty');
      if (thumb instanceof HTMLImageElement && url) {
        thumb.src = url;
        thumb.alt = '';
      }
      const text = create('span', 'upnext-text');
      text.append(create('span', 'upnext-title', upcoming.title), create('span', 'upnext-artist', upcoming.artist));
      button.append(grip, thumb, text, create('span', 'upnext-time', upcoming.duration ? formatTime(upcoming.duration) : ''));
      li.append(button);
      fragment.append(li);
    }
    const hidden = queue.upcomingCount(repeat) - items.length;
    if (hidden > 0) fragment.append(create('li', 'upnext-more', strings.stage.more(hidden)));
    if (items.length === 0) {
      fragment.append(create('li', 'upnext-empty', song ? strings.stage.endOfQueue : strings.stage.emptyQueue));
    }
    this.upnext.replaceChildren(fragment);
  }

  // ---- Drag to reorder the queue. Songs are identified by id, not by position,
  // because with repeat on the list wraps around. ----

  private bindUpnextDrag(): void {
    this.upnext.addEventListener('dragstart', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('.upnext-item');
      if (!item?.dataset.songId || !event.dataTransfer) return;
      this.dragSongId = item.dataset.songId;
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData('text/plain', item.querySelector('.upnext-title')?.textContent ?? '');
      // Lets the song also be dropped on a playlist of the sidebar.
      event.dataTransfer.setData(SONG_DRAG_TYPE, item.dataset.songId);
      item.classList.add('is-dragging');
    });

    this.upnext.addEventListener('dragover', (event) => {
      if (this.dragSongId === null) return;
      const item = (event.target as HTMLElement).closest<HTMLElement>('.upnext-item');
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      this.clearUpnextMarkers();
      if (item.dataset.songId !== this.dragSongId) item.classList.add(this.isAfter(event, item) ? 'drop-after' : 'drop-before');
    });

    this.upnext.addEventListener('dragleave', (event) => {
      if (!this.upnext.contains(event.relatedTarget as Node | null)) this.clearUpnextMarkers();
    });

    this.upnext.addEventListener('drop', (event) => {
      if (this.dragSongId === null) return;
      event.preventDefault();
      event.stopPropagation();
      const item = (event.target as HTMLElement).closest<HTMLElement>('.upnext-item');
      const songId = this.dragSongId;
      const refId = item?.dataset.songId;
      const where = item && this.isAfter(event, item) ? 'after' : 'before';
      this.endUpnextDrag();
      if (refId && refId !== songId) this.handlers.onMoveUpcoming(songId, refId, where);
    });

    this.upnext.addEventListener('dragend', () => this.endUpnextDrag());
  }

  private isAfter(event: DragEvent, item: HTMLElement): boolean {
    const rect = item.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  private clearUpnextMarkers(): void {
    this.upnext.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  }

  private endUpnextDrag(): void {
    this.dragSongId = null;
    this.clearUpnextMarkers();
    this.upnext.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
  }

  /** Drag the left edge to resize; dragging it narrow enough collapses the panel. */
  private bindResize(): void {
    let startX = 0;
    let startWidth = 0;
    let rawWidth = 0;
    let dragging = false;

    this.handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      dragging = true;
      startX = event.clientX;
      startWidth = this.width;
      rawWidth = this.width;
      this.handle.setPointerCapture(event.pointerId);
      document.body.classList.add('is-resizing');
    });

    this.handle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      rawWidth = startWidth + (startX - event.clientX);
      this.setWidth(rawWidth);
      document.body.classList.toggle('will-collapse', rawWidth < COLLAPSE_BELOW);
    });

    const stop = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('is-resizing', 'will-collapse');
      if (rawWidth < COLLAPSE_BELOW) {
        this.setWidth(STAGE_MIN);
        this.handlers.onModeRequest('mini');
      }
      this.handlers.onResize(this.width);
    };
    this.handle.addEventListener('pointerup', stop);
    this.handle.addEventListener('pointercancel', stop);

    this.handle.addEventListener('dblclick', () => {
      this.setWidth(STAGE_DEFAULT);
      this.handlers.onResize(this.width);
    });

    this.handle.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 64 : 16;
      const changes: Record<string, number> = {
        ArrowLeft: this.width + step,
        ArrowRight: this.width - step,
        Home: STAGE_MAX,
        End: STAGE_MIN,
      };
      if (!(event.key in changes)) return;
      event.preventDefault();
      this.setWidth(changes[event.key]);
      this.handlers.onResize(this.width);
    });
  }
}
