import type { Playlist } from '../core/Playlist';
import { ALL_SONGS_ID, type PlaylistLibrary } from '../core/PlaylistLibrary';
import type { CoverCache } from './CoverCache';
import { byId, create, formatTotal } from './dom';
import { icons } from './icons';
import { strings } from './strings';

export const SONG_DRAG_TYPE = 'application/x-music-player-song';
const PLAYLIST_DRAG_TYPE = 'application/x-music-player-playlist';

export interface SidebarHandlers {
  onOpen(playlistId: string): void;
  onCreate(name: string): void;
  onMove(fromIndex: number, toIndex: number): void;
  onDropSong(playlistId: string, songId: string): void;
}

/** The library sidebar: the DoublyLinkedList<Playlist>, one row per node. */
export class SidebarView {
  private readonly list = byId<HTMLOListElement>('library-list');
  private readonly form = byId<HTMLFormElement>('new-playlist-form');
  private readonly nameInput = byId<HTMLInputElement>('new-playlist-name');
  private dragFrom: number | null = null;

  constructor(private readonly handlers: SidebarHandlers) {
    byId('new-playlist-btn').addEventListener('click', () => this.openForm());
    byId('new-playlist-cancel').addEventListener('click', () => this.closeForm());
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.handlers.onCreate(this.nameInput.value);
      this.closeForm();
    });
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeForm();
    });

    this.list.addEventListener('click', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('.lib-item');
      if (item?.dataset.id) this.handlers.onOpen(item.dataset.id);
    });
    this.bindDrag();
  }

  openForm(defaultName = ''): void {
    this.form.hidden = false;
    this.nameInput.value = defaultName;
    this.nameInput.focus();
    this.nameInput.select();
  }

  private closeForm(): void {
    this.form.hidden = true;
    this.nameInput.value = '';
  }

  render(library: PlaylistLibrary, viewedId: string, activeId: string, playing: boolean, covers: CoverCache): void {
    const fragment = document.createDocumentFragment();
    let index = 0;
    for (const playlist of library.playlists) {
      fragment.append(this.item(playlist, index, playlist.id === viewedId, playlist.id === activeId && playing, covers));
      index++;
    }
    this.list.replaceChildren(fragment);
  }

  private item(playlist: Playlist, index: number, isViewed: boolean, isPlaying: boolean, covers: CoverCache): HTMLLIElement {
    const isAll = playlist.id === ALL_SONGS_ID;
    const li = create('li', 'lib-row');
    li.dataset.index = String(index);
    li.draggable = !isAll;

    const button = create('button', 'lib-item');
    button.type = 'button';
    button.dataset.id = playlist.id;
    if (isViewed) button.setAttribute('aria-current', 'page');
    if (isPlaying) button.classList.add('is-playing');

    const art = create('span', `lib-art${isAll ? ' lib-art--all' : ''}`);
    const firstCover = isAll ? null : covers.get(firstSongWithCover(playlist));
    if (firstCover) {
      const img = create('img');
      img.src = firstCover;
      img.alt = '';
      art.append(img);
    } else {
      art.innerHTML = isAll ? icons.library : icons.note;
    }

    const text = create('span', 'lib-text');
    const size = playlist.size;
    const meta = strings.sidebar.meta(isAll, size, size ? formatTotal(playlist.totalDuration()) : null);
    text.append(create('span', 'lib-name', playlist.name), create('span', 'lib-meta', meta));

    button.append(art, text);
    if (isPlaying) {
      const eq = create('span', 'eq');
      eq.setAttribute('aria-label', strings.playing);
      eq.innerHTML = '<i></i><i></i><i></i>';
      button.append(eq);
    }
    li.append(button);
    return li;
  }

  // ---- Drag: reorder playlists, or drop a song from the main list ----

  private bindDrag(): void {
    this.list.addEventListener('dragstart', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLLIElement>('.lib-row');
      if (!row || !event.dataTransfer || !row.draggable) return;
      this.dragFrom = Number(row.dataset.index);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(PLAYLIST_DRAG_TYPE, row.dataset.index ?? '');
      row.classList.add('is-dragging');
    });

    this.list.addEventListener('dragover', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLLIElement>('.lib-row');
      const types = Array.from(event.dataTransfer?.types ?? []);
      if (!row) return;

      if (types.includes(SONG_DRAG_TYPE)) {
        if (row.querySelector('[data-id]')?.getAttribute('data-id') === ALL_SONGS_ID) return;
        event.preventDefault();
        event.dataTransfer!.dropEffect = 'copy';
        this.clearMarkers();
        row.classList.add('is-drop-target');
      } else if (this.dragFrom !== null && Number(row.dataset.index) > 0) {
        event.preventDefault();
        this.clearMarkers();
        row.classList.add(this.isAfter(event, row) ? 'drop-after' : 'drop-before');
      }
    });

    this.list.addEventListener('dragleave', (event) => {
      const row = (event.target as HTMLElement).closest('.lib-row');
      if (row && !row.contains(event.relatedTarget as globalThis.Node | null)) row.classList.remove('is-drop-target');
    });

    this.list.addEventListener('drop', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLLIElement>('.lib-row');
      const transfer = event.dataTransfer;
      if (!row || !transfer) return;
      const songId = transfer.getData(SONG_DRAG_TYPE);
      const playlistId = row.querySelector<HTMLElement>('.lib-item')?.dataset.id;

      if (songId && playlistId) {
        event.preventDefault();
        this.handlers.onDropSong(playlistId, songId);
      } else if (this.dragFrom !== null) {
        event.preventDefault();
        const from = this.dragFrom;
        const target = Number(row.dataset.index);
        const slot = this.isAfter(event, row) ? target + 1 : target;
        const to = slot > from ? slot - 1 : slot;
        if (to !== from && to > 0) this.handlers.onMove(from, to);
      }
      this.endDrag();
    });

    this.list.addEventListener('dragend', () => this.endDrag());
    // A song drag that ends anywhere else must clear the highlight too.
    document.addEventListener('dragend', () => this.clearMarkers());
  }

  private isAfter(event: DragEvent, row: HTMLElement): boolean {
    const rect = row.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  private clearMarkers(): void {
    this.list
      .querySelectorAll('.drop-before, .drop-after, .is-drop-target')
      .forEach((el) => el.classList.remove('drop-before', 'drop-after', 'is-drop-target'));
  }

  private endDrag(): void {
    this.dragFrom = null;
    this.clearMarkers();
    this.list.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
  }
}

function firstSongWithCover(playlist: Playlist) {
  for (const song of playlist.songs) if (song.cover) return song;
  return null;
}
