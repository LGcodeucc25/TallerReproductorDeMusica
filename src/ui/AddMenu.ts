import type { PlaylistLibrary } from '../core/PlaylistLibrary';
import type { Song } from '../core/Song';
import { byId, create } from './dom';
import { icons } from './icons';
import { moveMenuFocus, positionMenu } from './menu';
import { strings } from './strings';

export interface AddMenuHandlers {
  onPlayNext(song: Song): void;
  onSave(song: Song): void;
  onAdd(playlistId: string, song: Song): void;
  onCreateWith(song: Song): void;
}

export interface AddMenuContext {
  library: PlaylistLibrary;
  /** The song that is sounding, which cannot be queued after itself. */
  nowPlayingId: string | null;
}

/**
 * Floating menu of a song: "play next", "save to your library" (Spotify songs not
 * saved yet), "open in Spotify" (Spotify's required link back) and "add to a playlist".
 */
export class AddMenu {
  private readonly menu = byId('add-menu');
  private anchor: HTMLElement | null = null;
  private song: Song | null = null;

  constructor(private readonly handlers: AddMenuHandlers) {
    this.menu.addEventListener('click', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('[data-command]');
      const song = this.song;
      if (!item || !song || (item instanceof HTMLButtonElement && item.disabled)) return;
      const command = item.dataset.command;
      this.close();
      if (command === 'play-next') this.handlers.onPlayNext(song);
      else if (command === 'save') this.handlers.onSave(song);
      else if (command === 'create') this.handlers.onCreateWith(song);
      else if (command === 'add') this.handlers.onAdd(item.dataset.playlistId!, song);
      // 'open' is a link: the browser opens Spotify in a new tab.
    });
    document.addEventListener('pointerdown', (event) => {
      if (!this.menu.hidden && !this.menu.contains(event.target as Node) && !this.anchor?.contains(event.target as Node)) this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.menu.hidden) {
        event.preventDefault();
        this.close(true);
      }
    });
    this.menu.addEventListener('keydown', (event) => moveMenuFocus(this.menu, event));
    window.addEventListener('resize', () => this.close());
    document.addEventListener('scroll', () => this.close(), true);
  }

  open(anchor: HTMLElement, song: Song, context: AddMenuContext): void {
    this.anchor = anchor;
    this.song = song;
    const { library } = context;
    const fragment = document.createDocumentFragment();

    const playNext = this.item('play-next', icons.next, strings.addMenu.playNext, 'menu-item--play-next');
    playNext.disabled = song.id === context.nowPlayingId;
    if (playNext.disabled) playNext.append(create('span', 'menu-note', strings.addMenu.nowPlaying));
    fragment.append(playNext);

    if (song.source === 'spotify') {
      if (!library.allSongs.has(song.id)) fragment.append(this.item('save', icons.library, strings.addMenu.saveToLibrary));
      const open = create('a', 'menu-item menu-item--link');
      open.href = song.externalUrl;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.dataset.command = 'open';
      open.setAttribute('role', 'menuitem');
      open.innerHTML = icons.spotify;
      open.append(create('span', 'menu-label', strings.addMenu.openInSpotify));
      fragment.append(open);
    }

    fragment.append(create('p', 'menu-title', strings.addMenu.addToPlaylist));
    for (const playlist of library.userPlaylists()) {
      const already = playlist.has(song.id);
      const item = this.item('add', already ? icons.check : icons.note, playlist.name);
      item.dataset.playlistId = playlist.id;
      item.disabled = already;
      if (already) item.append(create('span', 'menu-note', strings.addMenu.alreadyThere));
      fragment.append(item);
    }
    fragment.append(this.item('create', icons.plus, strings.addMenu.newPlaylistWith, 'menu-item--create'));

    this.menu.replaceChildren(fragment);
    this.menu.hidden = false;
    positionMenu(this.menu, anchor);
    this.menu.querySelector<HTMLElement>('button:not(:disabled), a[href]')?.focus();
  }

  close(returnFocus = false): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    if (returnFocus) this.anchor?.focus();
    this.anchor = null;
  }

  private item(command: string, icon: string, label: string, extraClass = ''): HTMLButtonElement {
    const item = create('button', `menu-item ${extraClass}`.trim());
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.dataset.command = command;
    item.innerHTML = icon;
    item.append(create('span', 'menu-label', label));
    return item;
  }
}
