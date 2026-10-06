import type { Playlist } from '../core/Playlist';
import { ALL_SONGS_ID, type PlaylistLibrary } from '../core/PlaylistLibrary';
import { byId, create, formatTotal } from './dom';
import { strings } from './strings';

export const SONG_DRAG_TYPE = 'application/x-music-player-song';
const PLAYLIST_DRAG_TYPE = 'application/x-music-player-playlist';

export interface SidebarHandlers {
  onOpen(playlistId: string): void;
  onCreate(name: string): void;
  onMove(fromIndex: number, toIndex: number): void;
  onDropSong(playlistId: string, songId: string): void;
}

/** The shelf of the library: the DoublyLinkedList<Playlist>, one cassette spine per node. */
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
      const item = (event.target as HTMLElement).closest<HTMLElement>('.spine');
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

  render(library: PlaylistLibrary, viewedId: string, activeId: string, playing: boolean): void {
    const fragment = document.createDocumentFragment();
    let index = 0;
    for (const playlist of library.playlists) {
      const li = create('li', 'lib-row');
      li.dataset.index = String(index);
      li.draggable = playlist.id !== ALL_SONGS_ID;
      li.append(createSpine(playlist, { viewed: playlist.id === viewedId, playing: playlist.id === activeId && playing }));
      fragment.append(li);
      index++;
    }
    this.list.replaceChildren(fragment);
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
      const playlistId = row.querySelector<HTMLElement>('.spine')?.dataset.id;

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

/** Spine stripes: the all-songs playlist is always the blue one; the others get a stable colour from their id. */
const SPINE_STRIPES = [
  'linear-gradient(90deg, #F59A1E 0 33%, #DB3A1F 33% 66%, #A3141E 66%)',
  'linear-gradient(90deg, #1E6286 0 33%, #6CCFC6 33% 66%, #F5C59A 66%)',
  'linear-gradient(90deg, #F5C59A 0 33%, #F59A1E 33% 66%, #DB3A1F 66%)',
];
const LIBRARY_STRIPE = 'linear-gradient(90deg, #0F3A5C 0 33%, #2E9AA5 33% 66%, #6CCFC6 66%)';

export function spineStripe(playlist: Playlist): string {
  if (playlist.id === ALL_SONGS_ID) return LIBRARY_STRIPE;
  let hash = 0;
  for (const char of playlist.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SPINE_STRIPES[hash % SPINE_STRIPES.length];
}

/** A playlist as a cassette spine: stripes, name and the number of songs. */
export function createSpine(playlist: Playlist, state: { viewed: boolean; playing: boolean }): HTMLButtonElement {
  const isAll = playlist.id === ALL_SONGS_ID;
  const size = playlist.size;
  const button = create('button', 'spine');
  button.type = 'button';
  button.dataset.id = playlist.id;
  if (state.viewed) button.setAttribute('aria-current', 'page');
  if (state.playing) button.classList.add('is-playing');
  const meta = strings.sidebar.meta(isAll, size, size ? formatTotal(playlist.totalDuration()) : null);
  button.setAttribute('aria-label', `${playlist.name}. ${meta}${state.playing ? `. ${strings.playing}` : ''}`);
  button.title = meta;

  const stripe = create('span', 'spine-stripe');
  stripe.style.setProperty('--spine', spineStripe(playlist));
  stripe.setAttribute('aria-hidden', 'true');
  const name = create('span', 'spine-name', playlist.name);
  name.setAttribute('aria-hidden', 'true');
  const count = create('span', 'spine-count', String(size).padStart(2, '0'));
  count.setAttribute('aria-hidden', 'true');
  button.append(stripe, name);
  if (state.playing) {
    const eq = create('span', 'eq');
    eq.setAttribute('aria-hidden', 'true');
    eq.innerHTML = '<i></i><i></i><i></i>';
    button.append(eq);
  }
  button.append(count);
  return button;
}
