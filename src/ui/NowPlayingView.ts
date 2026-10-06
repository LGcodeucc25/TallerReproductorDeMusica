import type { PlaybackQueue } from '../core/PlaybackQueue';
import type { RepeatMode } from '../core/Playlist';
import type { Song } from '../core/Song';
import type { CoverCache } from './CoverCache';
import { byId, create, formatCounter } from './dom';
import { edgeScrollSpeed } from './dragScroll';
import { icons, setIcon } from './icons';
import type { NextUp, QueueNote } from './nextUp';
import { SONG_DRAG_TYPE } from './SidebarView';
import { spotifyMark } from './songRow';
import { strings } from './strings';

/** Songs shown in the up-next list; the rest are summarized as a count. */
export const UPNEXT_LIMIT = 30;

/** How far outside the list (in px) a dragged song still scrolls it. */
const AUTO_SCROLL_REACH = 48;

const NOTES: Record<QueueNote, string> = {
  repeatOne: strings.stage.repeatOne,
  end: strings.stage.endOfQueue,
  empty: strings.stage.emptyQueue,
};

export interface NowPlayingHandlers {
  /** The "playing from <playlist>" chip: opens that playlist in the library. */
  onOpenSource(): void;
  onMinimize(): void;
  /** "Add to playlist" for the current song. */
  onAddCurrent(anchor: HTMLElement): void;
  onPickUpcoming(songId: string): void;
  /** A queued song was dropped before or after another one (changes the queue only). */
  onMoveUpcoming(songId: string, refSongId: string, where: 'before' | 'after'): void;
  /** "Re-shuffle": a new order for the songs after the current one. */
  onReshuffle(): void;
  /** The queue was expanded or collapsed (saved with the UI state). */
  onQueueExpanded(expanded: boolean): void;
}

export interface NowPlayingState {
  queue: PlaybackQueue;
  sourceName: string | null;
  repeat: RepeatMode;
  covers: CoverCache;
  /** What plays next: the same rule for the next-song card, the queue and the next key. */
  upNext: NextUp<Song>;
}

/**
 * The player screen around the cassette: where the music comes from, the song
 * that is playing, the previous and next songs and the up-next queue (side B).
 */
export class NowPlayingView {
  private readonly from = byId('stage-from');
  private readonly source = byId<HTMLButtonElement>('stage-source');
  private readonly coverImg = byId<HTMLImageElement>('cover-img');
  private readonly coverEmpty = byId('cover-empty');
  private readonly mark = byId('np-mark');
  private readonly addBtn = byId<HTMLButtonElement>('stage-add-btn');
  private readonly prev = byId('neighbor-prev');
  private readonly next = byId('neighbor-next');
  private readonly side = byId('side-b');
  private readonly upnext = byId<HTMLOListElement>('upnext-list');
  private readonly count = byId('queue-count');
  private readonly toggle = byId<HTMLButtonElement>('queue-toggle');
  private readonly reshuffle = byId<HTMLButtonElement>('queue-reshuffle');
  private expanded = false;
  /** Song being dragged inside the up-next list. */
  private dragSongId: string | null = null;
  /** Last pointer position during a drag, for the auto-scroll near the list edges. */
  private pointer: { x: number; y: number } | null = null;
  private scrollFrame = 0;
  private readonly trackPointer = (event: DragEvent) => {
    this.pointer = { x: event.clientX, y: event.clientY };
  };

  constructor(private readonly handlers: NowPlayingHandlers) {
    this.mark.append(spotifyMark());
    this.source.addEventListener('click', () => handlers.onOpenSource());
    this.addBtn.addEventListener('click', () => handlers.onAddCurrent(this.addBtn));
    byId('minimize-btn').addEventListener('click', () => handlers.onMinimize());
    this.reshuffle.setAttribute('aria-label', strings.stage.reshuffle);
    this.reshuffle.title = strings.stage.reshuffle;
    this.reshuffle.addEventListener('click', () => handlers.onReshuffle());
    this.toggle.addEventListener('click', () => {
      this.setQueueExpanded(!this.expanded);
      handlers.onQueueExpanded(this.expanded);
    });
    this.upnext.addEventListener('click', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('[data-song-id]');
      if (item?.dataset.songId) handlers.onPickUpcoming(item.dataset.songId);
    });
    this.bindUpnextDrag();
    this.setQueueExpanded(false);
  }

  /** Expanded, the queue takes the whole column and the song card shrinks to a row. */
  setQueueExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.side.dataset.queueExpanded = String(expanded);
    this.toggle.setAttribute('aria-expanded', String(expanded));
    const label = expanded ? strings.stage.collapseQueue : strings.stage.expandQueue;
    this.toggle.setAttribute('aria-label', label);
    this.toggle.title = label;
    setIcon(this.toggle, expanded ? 'down' : 'up');
  }

  render(state: NowPlayingState): void {
    const { queue, covers, repeat, upNext } = state;
    const song = queue.current;

    this.from.hidden = !song || !state.sourceName;
    this.source.hidden = this.from.hidden;
    this.source.textContent = state.sourceName ?? '';
    this.source.setAttribute('aria-label', strings.stage.openSource(state.sourceName ?? ''));
    this.addBtn.disabled = !song;
    this.mark.hidden = song?.source !== 'spotify';

    const coverUrl = covers.get(song);
    this.coverImg.hidden = !coverUrl;
    this.coverEmpty.hidden = !!coverUrl;
    if (coverUrl) {
      if (this.coverImg.src !== coverUrl) this.coverImg.src = coverUrl;
    } else {
      this.coverImg.removeAttribute('src');
    }

    // The songs that previous and next would actually play, wrapping when repeat is on.
    const previous = queue.peekPrevious(repeat);
    this.prev.textContent = previous?.title ?? strings.stage.nothing;
    this.next.textContent = upNext.next?.title ?? strings.stage.nothing;
    this.prev.classList.toggle('is-empty', !previous);
    this.next.classList.toggle('is-empty', !upNext.next);

    // A single song with repeat 'all' is listed although `upcoming` leaves it out.
    const total = Math.max(queue.upcomingCount(repeat), upNext.items.length);
    this.count.textContent = song ? String(total).padStart(2, '0') : '';
    // Re-shuffling needs at least two songs after the current one.
    this.reshuffle.disabled = queue.songsAfterCurrent < 2;
    this.renderUpnext(state, total);
  }

  private renderUpnext({ queue, covers, upNext }: NowPlayingState, total: number): void {
    const fragment = document.createDocumentFragment();
    if (upNext.note === 'repeatOne') fragment.append(create('li', 'upnext-empty', NOTES.repeatOne));
    let dividerShown = false;
    for (const upcoming of upNext.items) {
      // The songs continuous playback added come after a small divider.
      if (!dividerShown && queue.isAutoAdded(upcoming)) {
        dividerShown = true;
        const divider = create('li', 'upnext-divider', strings.stage.continuous);
        divider.setAttribute('role', 'separator');
        fragment.append(divider);
      }
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
      const artist = create('span', 'upnext-artist');
      if (upcoming.source === 'spotify') artist.append(spotifyMark());
      artist.append(upcoming.artist);
      text.append(create('span', 'upnext-title', upcoming.title), artist);
      button.append(grip, thumb, text, create('span', 'upnext-time', upcoming.duration ? formatCounter(upcoming.duration) : ''));
      li.append(button);
      fragment.append(li);
    }
    const hidden = total - upNext.items.length;
    if (hidden > 0) fragment.append(create('li', 'upnext-more', strings.stage.more(hidden)));
    if (upNext.note === 'end' || upNext.note === 'empty') fragment.append(create('li', 'upnext-empty', NOTES[upNext.note]));
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
      // Lets the song also be dropped on a playlist of the shelf.
      event.dataTransfer.setData(SONG_DRAG_TYPE, item.dataset.songId);
      item.classList.add('is-dragging');
      this.startAutoScroll();
    });

    this.upnext.addEventListener('dragover', (event) => {
      if (this.dragSongId === null) return;
      const item = (event.target as HTMLElement).closest<HTMLElement>('.upnext-item');
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      this.clearMarkers();
      if (item.dataset.songId !== this.dragSongId) item.classList.add(this.isAfter(event, item) ? 'drop-after' : 'drop-before');
    });

    this.upnext.addEventListener('dragleave', (event) => {
      if (!this.upnext.contains(event.relatedTarget as Node | null)) this.clearMarkers();
    });

    this.upnext.addEventListener('drop', (event) => {
      if (this.dragSongId === null) return;
      event.preventDefault();
      event.stopPropagation();
      const item = (event.target as HTMLElement).closest<HTMLElement>('.upnext-item');
      const songId = this.dragSongId;
      const refId = item?.dataset.songId;
      const where = item && this.isAfter(event, item) ? 'after' : 'before';
      this.endDrag();
      if (refId && refId !== songId) this.handlers.onMoveUpcoming(songId, refId, where);
    });

    this.upnext.addEventListener('dragend', () => this.endDrag());
  }

  /** While a song is dragged, scrolls the list when the pointer is near its top or bottom edge. */
  private startAutoScroll(): void {
    document.addEventListener('dragover', this.trackPointer);
    const step = () => {
      if (this.dragSongId === null) return;
      const list = this.upnext;
      if (this.pointer && list.scrollHeight > list.clientHeight) {
        const rect = list.getBoundingClientRect();
        const { x, y } = this.pointer;
        const near = x >= rect.left && x <= rect.right && y >= rect.top - AUTO_SCROLL_REACH && y <= rect.bottom + AUTO_SCROLL_REACH;
        if (near) list.scrollTop += edgeScrollSpeed(y, rect.top, rect.bottom);
      }
      this.scrollFrame = requestAnimationFrame(step);
    };
    this.scrollFrame = requestAnimationFrame(step);
  }

  private stopAutoScroll(): void {
    cancelAnimationFrame(this.scrollFrame);
    document.removeEventListener('dragover', this.trackPointer);
    this.pointer = null;
  }

  private isAfter(event: DragEvent, item: HTMLElement): boolean {
    const rect = item.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  private clearMarkers(): void {
    this.upnext.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  }

  private endDrag(): void {
    this.dragSongId = null;
    this.stopAutoScroll();
    this.clearMarkers();
    this.upnext.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
  }
}
