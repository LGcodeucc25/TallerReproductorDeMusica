import type { Playlist } from '../core/Playlist';
import type { Song } from '../core/Song';
import type { CoverCache } from './CoverCache';
import { byId, create, formatCounter } from './dom';
import { icons } from './icons';
import { strings } from './strings';

/** Dialog to add songs that are already in the library to the open playlist. */
export class LibraryPicker {
  private readonly dialog = byId<HTMLDialogElement>('picker-dialog');
  private readonly list = byId<HTMLUListElement>('picker-list');
  private readonly search = byId<HTMLInputElement>('picker-search');
  private readonly confirm = byId<HTMLButtonElement>('picker-confirm');
  private readonly note = byId('picker-note');
  private resolve: ((songs: Song[]) => void) | null = null;
  private songs = new Map<string, Song>();

  constructor() {
    this.search.addEventListener('input', () => this.filter());
    this.list.addEventListener('change', () => this.updateConfirm());
    this.dialog.addEventListener('close', () => {
      const chosen =
        this.dialog.returnValue === 'confirm'
          ? Array.from(this.list.querySelectorAll<HTMLInputElement>('input:checked')).map((input) => this.songs.get(input.value)!)
          : [];
      this.resolve?.(chosen);
      this.resolve = null;
    });
  }

  /** Resolves with the chosen songs, in library order (empty if cancelled). */
  pick(library: Playlist, target: Playlist, covers: CoverCache): Promise<Song[]> {
    this.songs = new Map();
    this.search.value = '';
    byId('picker-title').textContent = strings.picker.title(target.name);
    this.note.textContent =
      library.size === 0 ? strings.picker.emptyLibrary : strings.picker.note;

    const fragment = document.createDocumentFragment();
    for (const song of library.songs) {
      this.songs.set(song.id, song);
      const already = target.has(song.id);
      const li = create('li', 'picker-row');
      li.dataset.search = `${song.title} ${song.artist} ${song.album}`.toLowerCase();
      const label = create('label');
      const input = create('input');
      input.type = 'checkbox';
      input.value = song.id;
      input.disabled = already;

      const url = covers.get(song);
      let thumb: HTMLElement;
      if (url) {
        const img = create('img', 'picker-cover');
        img.src = url;
        img.alt = '';
        img.loading = 'lazy';
        thumb = img;
      } else {
        thumb = create('span', 'picker-cover picker-cover--empty');
        thumb.innerHTML = icons.note;
      }

      const text = create('span', 'picker-text');
      text.append(create('span', 'picker-title', song.title), create('span', 'picker-artist', song.artist));
      label.append(input, thumb, text, create('span', 'picker-meta', already ? strings.picker.alreadyThere : song.duration ? formatCounter(song.duration) : ''));
      li.append(label);
      fragment.append(li);
    }
    this.list.replaceChildren(fragment);
    this.updateConfirm();
    this.dialog.returnValue = '';
    this.dialog.showModal();
    this.search.focus();
    return new Promise((resolve) => (this.resolve = resolve));
  }

  private filter(): void {
    const query = this.search.value.trim().toLowerCase();
    for (const row of Array.from(this.list.children) as HTMLElement[]) {
      row.hidden = !!query && !(row.dataset.search ?? '').includes(query);
    }
  }

  private updateConfirm(): void {
    const count = this.list.querySelectorAll('input:checked').length;
    this.confirm.disabled = count === 0;
    this.confirm.textContent = strings.picker.confirm(count);
  }
}
