import type { Playlist, SortKey } from '../core/Playlist';
import { ALL_SONGS_ID } from '../core/PlaylistLibrary';
import { byId, formatTotal } from './dom';
import { setIcon } from './icons';
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

/** Header of the open playlist: the J-card, the striped title, the tape meta and its actions. */
export class HeaderView {
  private readonly jcardName = byId('playlist-art');
  private readonly name = byId('playlist-name');
  private readonly meta = byId('playlist-meta');
  private readonly renameForm = byId<HTMLFormElement>('rename-form');
  private readonly renameInput = byId<HTMLInputElement>('rename-input');
  private readonly playBtn = byId<HTMLButtonElement>('playlist-play');
  private readonly playText = byId('playlist-play-text');
  private readonly reverseBtn = byId<HTMLButtonElement>('reverse-btn');
  private readonly sortButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-sort]'));
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
    for (const button of this.sortButtons) {
      button.addEventListener('click', () => handlers.onSort(button.dataset.sort as SortKey));
    }

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

  /** Called when another playlist is opened. */
  reset(): void {
    this.stopRename();
    this.search.value = '';
  }

  render(playlist: Playlist, isActive: boolean, playing: boolean): void {
    const isAll = playlist.id === ALL_SONGS_ID;
    const size = playlist.size;
    const total = playlist.totalDuration();

    this.name.textContent = playlist.name;
    this.jcardName.textContent = playlist.name;
    this.meta.textContent = strings.header.tapeMeta(isAll, size, formatTotal(total));
    this.meta.setAttribute('aria-label', strings.header.meta(isAll, size, formatTotal(total)));

    const showPause = isActive && playing;
    setIcon(this.playBtn, showPause ? 'pause' : 'play');
    this.playText.textContent = showPause ? strings.pause : strings.play;
    this.playBtn.setAttribute('aria-label', showPause ? strings.pause : strings.playPlaylist(playlist.name));
    this.playBtn.disabled = size === 0;
    this.reverseBtn.disabled = size < 2;
    for (const button of this.sortButtons) button.disabled = size < 2;

    this.addBtn.hidden = isAll;
    this.renameBtn.hidden = isAll;
    this.deleteBtn.hidden = isAll;
    this.clearBtn.hidden = size === 0;
    this.clearLabel.textContent = isAll ? strings.header.clearLibrary : strings.header.clearPlaylist;
    this.search.setAttribute('aria-label', isAll ? strings.header.searchLibrary : strings.header.searchPlaylist);
    this.emptyText.innerHTML = isAll ? strings.header.emptyLibraryHtml : strings.header.emptyPlaylistHtml;
  }
}
