import type { Playlist, SortKey } from '../core/Playlist';
import { ALL_SONGS_ID } from '../core/PlaylistLibrary';
import type { CoverCache } from './CoverCache';
import { byId, create, formatTotal } from './dom';
import { icons, setIcon } from './icons';
import { moveMenuFocus, positionMenu } from './menu';
import { strings } from './strings';

export interface HeaderHandlers {
  onPlay(): void;
  onReverse(): void;
  onSort(key: SortKey): void;
  onAddFromLibrary(): void;
  onRename(name: string): void;
  onDelete(): void;
  onClear(): void;
}

/** Header of the open playlist: art, name, meta and its actions. */
export class HeaderView {
  private readonly art = byId('playlist-art');
  private readonly name = byId('playlist-name');
  private readonly meta = byId('playlist-meta');
  private readonly renameForm = byId<HTMLFormElement>('rename-form');
  private readonly renameInput = byId<HTMLInputElement>('rename-input');
  private readonly playBtn = byId<HTMLButtonElement>('playlist-play');
  private readonly reverseBtn = byId<HTMLButtonElement>('reverse-btn');
  private readonly sortBtn = byId<HTMLButtonElement>('sort-btn');
  private readonly sortMenu = byId('sort-menu');
  private readonly addBtn = byId<HTMLButtonElement>('add-from-library-btn');
  private readonly renameBtn = byId<HTMLButtonElement>('rename-btn');
  private readonly deleteBtn = byId<HTMLButtonElement>('delete-playlist-btn');
  private readonly clearBtn = byId<HTMLButtonElement>('clear-btn');
  private readonly clearLabel = byId('clear-label');
  private readonly emptyText = byId('queue-empty-text');
  private readonly search = byId<HTMLInputElement>('search');

  constructor(handlers: HeaderHandlers) {
    this.playBtn.addEventListener('click', () => handlers.onPlay());
    this.reverseBtn.addEventListener('click', () => handlers.onReverse());
    this.addBtn.addEventListener('click', () => handlers.onAddFromLibrary());
    this.deleteBtn.addEventListener('click', () => handlers.onDelete());
    this.clearBtn.addEventListener('click', () => handlers.onClear());

    this.bindSortMenu(handlers);

    this.renameBtn.addEventListener('click', () => this.startRename());
    byId('rename-cancel').addEventListener('click', () => this.stopRename());
    this.renameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.stopRename();
    });
    this.renameForm.addEventListener('submit', (event) => {
      event.preventDefault();
      handlers.onRename(this.renameInput.value);
      this.stopRename();
    });
  }

  startRename(): void {
    if (this.renameBtn.hidden) return;
    this.renameInput.value = this.name.textContent ?? '';
    this.renameForm.hidden = false;
    this.name.hidden = true;
    this.renameInput.focus();
    this.renameInput.select();
  }

  private stopRename(): void {
    this.renameForm.hidden = true;
    this.name.hidden = false;
  }

  // ---- Sort menu: click or arrow keys open it, Esc closes it and returns the focus ----

  private bindSortMenu(handlers: HeaderHandlers): void {
    this.sortBtn.addEventListener('click', () => (this.sortMenu.hidden ? this.openSort('first') : this.closeSort()));
    this.sortBtn.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      this.openSort(event.key === 'ArrowUp' ? 'last' : 'first');
    });
    this.sortMenu.addEventListener('click', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-sort]');
      if (!item) return;
      this.closeSort(true);
      handlers.onSort(item.dataset.sort as SortKey);
    });
    this.sortMenu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeSort(true);
      } else if (event.key === 'Tab') {
        this.closeSort();
      } else {
        moveMenuFocus(this.sortMenu, event);
      }
    });
    document.addEventListener('pointerdown', (event) => {
      const target = event.target as Node;
      if (!this.sortMenu.hidden && !this.sortMenu.contains(target) && !this.sortBtn.contains(target)) this.closeSort();
    });
    window.addEventListener('resize', () => this.closeSort());
    document.addEventListener('scroll', () => this.closeSort(), true);
  }

  private openSort(focus: 'first' | 'last'): void {
    if (this.sortBtn.disabled) return;
    this.sortMenu.hidden = false;
    this.sortBtn.setAttribute('aria-expanded', 'true');
    positionMenu(this.sortMenu, this.sortBtn, 'start');
    const items = this.sortMenu.querySelectorAll<HTMLButtonElement>('[data-sort]');
    items[focus === 'first' ? 0 : items.length - 1]?.focus();
  }

  private closeSort(returnFocus = false): void {
    if (this.sortMenu.hidden) return;
    this.sortMenu.hidden = true;
    this.sortBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus) this.sortBtn.focus();
  }

  /** Called when another playlist is opened. */
  reset(): void {
    this.closeSort();
    this.stopRename();
    this.search.value = '';
  }

  render(playlist: Playlist, isActive: boolean, playing: boolean, covers: CoverCache): void {
    const isAll = playlist.id === ALL_SONGS_ID;
    const size = playlist.size;

    this.name.textContent = playlist.name;
    this.meta.textContent = strings.header.meta(isAll, size, formatTotal(playlist.totalDuration()));
    this.renderArt(playlist, isAll, covers);

    const showPause = isActive && playing;
    setIcon(this.playBtn, showPause ? 'pause' : 'play');
    this.playBtn.setAttribute('aria-label', showPause ? strings.pause : strings.playPlaylist(playlist.name));
    this.playBtn.disabled = size === 0;
    this.reverseBtn.disabled = size < 2;
    this.sortBtn.disabled = size < 2;
    if (size < 2) this.closeSort();

    this.addBtn.hidden = isAll;
    this.renameBtn.hidden = isAll;
    this.deleteBtn.hidden = isAll;
    this.clearBtn.hidden = size === 0;
    this.clearLabel.textContent = isAll ? strings.header.clearLibrary : strings.header.clearPlaylist;
    this.search.placeholder = isAll ? strings.header.searchLibrary : strings.header.searchPlaylist;
    this.emptyText.innerHTML = isAll ? strings.header.emptyLibraryHtml : strings.header.emptyPlaylistHtml;
  }

  /** Mosaic with up to four covers, like the big art of a playlist. */
  private renderArt(playlist: Playlist, isAll: boolean, covers: CoverCache): void {
    const urls: string[] = [];
    for (const song of playlist.songs) {
      const url = covers.get(song);
      if (url && !urls.includes(url)) urls.push(url);
      if (urls.length === 4) break;
    }
    this.art.className = 'playlist-art';
    if (urls.length === 0) {
      this.art.innerHTML = isAll ? icons.library : icons.note;
      this.art.classList.add('playlist-art--empty');
      return;
    }
    const shown = urls.length >= 4 ? urls : urls.slice(0, 1);
    if (shown.length === 4) this.art.classList.add('playlist-art--mosaic');
    this.art.replaceChildren(
      ...shown.map((url) => {
        const img = create('img');
        img.src = url;
        img.alt = '';
        return img;
      }),
    );
  }
}
