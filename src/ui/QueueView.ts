import type { Playlist } from '../core/Playlist';
import type { Song } from '../core/Song';
import type { CoverCache } from './CoverCache';
import { byId } from './dom';
import { filesFromDrop, hasFiles } from './fileDrop';
import { SONG_DRAG_TYPE } from './SidebarView';
import { createSongRow } from './songRow';
import { strings } from './strings';

export interface QueueHandlers {
  onPlay(index: number): void;
  onRemove(index: number): void;
  onMove(fromIndex: number, toIndex: number): void;
  onAddTo(songId: string, anchor: HTMLElement): void;
  /** Files dropped from the computer into the gap `slotIndex` (0 = before the first row). */
  onDropFiles(files: File[], slotIndex: number): void;
}

export interface QueueRenderState {
  covers: CoverCache;
  loadedId: string | null;
  playing: boolean;
  isLibrary: boolean;
  isPlayable(song: Song): boolean;
}

/** Songs of the open playlist: play, add to a playlist, move, remove, drag. */
export class QueueView {
  private readonly list = byId<HTMLOListElement>('queue-list');
  private readonly empty = byId('queue-empty');
  private readonly noResults = byId('queue-noresults');
  private readonly search = byId<HTMLInputElement>('search');
  private dragFrom: number | null = null;

  constructor(private readonly handlers: QueueHandlers) {
    this.search.addEventListener('input', () => this.applyFilter());
    this.list.addEventListener('click', (event) => this.onClick(event));
    this.bindDrag();
  }

  render(playlist: Playlist, state: QueueRenderState): void {
    const fragment = document.createDocumentFragment();
    let index = 0;
    for (const song of playlist.songs) {
      fragment.append(
        createSongRow(song, {
          index,
          isLoaded: song.id === state.loadedId,
          playing: state.playing,
          playable: state.isPlayable(song),
          covers: state.covers,
          actions: ['add', 'up', 'down', 'remove'],
          removeLabel: state.isLibrary ? strings.row.deleteFromLibrary(song.title) : strings.row.removeFromPlaylist(song.title),
          draggable: true,
        }),
      );
      index++;
    }
    this.list.replaceChildren(fragment);
    this.empty.hidden = playlist.size > 0;
    this.list.hidden = playlist.size === 0;
    this.applyFilter();
  }

  private onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    const row = (event.target as HTMLElement).closest<HTMLLIElement>('.row');
    if (!row) return;
    const index = Number(row.dataset.index);
    const action = target?.dataset.action ?? 'play';

    if (action === 'play') this.handlers.onPlay(index);
    else if (action === 'remove') this.handlers.onRemove(index);
    else if (action === 'add' && target) this.handlers.onAddTo(row.dataset.songId!, target);
    else if (action === 'up' && index > 0) this.handlers.onMove(index, index - 1);
    else if (action === 'down' && index < this.list.children.length - 1) this.handlers.onMove(index, index + 1);
  }

  private applyFilter(): void {
    const query = this.search.value.trim().toLowerCase();
    let visible = 0;
    for (const row of Array.from(this.list.children) as HTMLElement[]) {
      const match = !query || (row.dataset.search ?? '').includes(query);
      row.hidden = !match;
      if (match) visible++;
    }
    this.noResults.hidden = !query || visible > 0 || this.list.children.length === 0;
  }

  // ---- Drag to reorder, and files dropped from the computer into an exact gap ----

  private bindDrag(): void {
    this.list.addEventListener('dragstart', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLLIElement>('.row');
      if (!row || !event.dataTransfer) return;
      this.dragFrom = Number(row.dataset.index);
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData('text/plain', row.querySelector('.row-title')?.textContent ?? '');
      event.dataTransfer.setData(SONG_DRAG_TYPE, row.dataset.songId ?? '');
      row.classList.add('is-dragging');
    });

    this.list.addEventListener('dragover', (event) => {
      const files = this.dragFrom === null && hasFiles(event);
      if (this.dragFrom === null && !files) return;
      const target = this.dropTarget(event);
      if (!target) return;
      event.preventDefault();
      // Files keep bubbling so the App can hide its full-page overlay over the list.
      if (!files) event.stopPropagation();
      else if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      this.clearMarkers();
      target.row.classList.add(target.after ? 'drop-after' : 'drop-before');
    });

    this.list.addEventListener('dragleave', (event) => {
      if (!this.list.contains(event.relatedTarget as Node | null)) this.clearMarkers();
    });

    this.list.addEventListener('drop', (event) => {
      if (this.dragFrom === null && hasFiles(event) && event.dataTransfer) {
        const target = this.dropTarget(event);
        if (!target) return; // let the page-level handler add them at the end
        event.preventDefault();
        event.stopPropagation(); // the App must not import them a second time
        const slot = Number(target.row.dataset.index) + (target.after ? 1 : 0);
        this.clearMarkers();
        // filesFromDrop reads the DataTransfer synchronously before its first await.
        void filesFromDrop(event.dataTransfer).then((files) => this.handlers.onDropFiles(files, slot));
        return;
      }

      if (this.dragFrom === null) return;
      const row = (event.target as HTMLElement).closest<HTMLLIElement>('.row');
      event.preventDefault();
      event.stopPropagation();
      if (row) {
        const from = this.dragFrom;
        const target = Number(row.dataset.index);
        const slot = this.isAfter(event, row) ? target + 1 : target;
        const to = slot > from ? slot - 1 : slot;
        if (to !== from) this.handlers.onMove(from, to);
      }
      this.endDrag();
    });

    this.list.addEventListener('dragend', () => this.endDrag());
  }

  /** Row under the pointer and which half of it. For files, the small gaps between rows also count. */
  private dropTarget(event: DragEvent): { row: HTMLLIElement; after: boolean } | null {
    const row = (event.target as HTMLElement).closest<HTMLLIElement>('.row');
    if (row) return { row, after: this.isAfter(event, row) };
    if (this.dragFrom !== null) return null;
    const visible = Array.from(this.list.children).filter((el) => !(el as HTMLElement).hidden) as HTMLLIElement[];
    const last = visible[visible.length - 1];
    if (!last) return null;
    // Pointer between two rows: drop before the first row below it.
    const below = visible.find((el) => !this.isAfter(event, el));
    return below ? { row: below, after: false } : { row: last, after: true };
  }

  private isAfter(event: DragEvent, row: HTMLElement): boolean {
    const rect = row.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  private clearMarkers(): void {
    this.list.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  }

  private endDrag(): void {
    this.dragFrom = null;
    this.clearMarkers();
    this.list.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
  }
}
