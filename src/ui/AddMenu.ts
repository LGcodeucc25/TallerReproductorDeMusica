import { type PlaylistLibrary } from '../core/PlaylistLibrary';
import { byId, create } from './dom';
import { icons } from './icons';
import { moveMenuFocus, positionMenu } from './menu';
import { strings } from './strings';

export interface AddMenuHandlers {
  onPlayNext(songId: string): void;
  onAdd(playlistId: string, songId: string): void;
  onCreateWith(songId: string): void;
}

/** Small floating menu of a song: "play next" and "add to a playlist". */
export class AddMenu {
  private readonly menu = byId('add-menu');
  private anchor: HTMLElement | null = null;

  constructor(private readonly handlers: AddMenuHandlers) {
    this.menu.addEventListener('click', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-playlist-id], [data-create], [data-play-next]');
      if (!item || item.disabled) return;
      const songId = this.menu.dataset.songId!;
      this.close();
      if (item.dataset.playNext) this.handlers.onPlayNext(songId);
      else if (item.dataset.create) this.handlers.onCreateWith(songId);
      else this.handlers.onAdd(item.dataset.playlistId!, songId);
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

  /** `nowPlayingId`: the song that is sounding, which cannot be queued after itself. */
  open(anchor: HTMLElement, songId: string, library: PlaylistLibrary, nowPlayingId: string | null): void {
    this.anchor = anchor;
    this.menu.dataset.songId = songId;
    const fragment = document.createDocumentFragment();

    const playNext = create('button', 'menu-item menu-item--play-next');
    playNext.type = 'button';
    playNext.setAttribute('role', 'menuitem');
    playNext.dataset.playNext = 'true';
    playNext.disabled = songId === nowPlayingId;
    playNext.innerHTML = icons.next;
    playNext.append(create('span', 'menu-label', strings.addMenu.playNext));
    if (playNext.disabled) playNext.append(create('span', 'menu-note', strings.addMenu.nowPlaying));
    fragment.append(playNext, create('p', 'menu-title', strings.addMenu.addToPlaylist));

    for (const playlist of library.userPlaylists()) {
      const already = playlist.has(songId);
      const item = create('button', 'menu-item');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.dataset.playlistId = playlist.id;
      item.disabled = already;
      item.innerHTML = already ? icons.check : icons.note;
      item.append(create('span', 'menu-label', playlist.name));
      if (already) item.append(create('span', 'menu-note', strings.addMenu.alreadyThere));
      fragment.append(item);
    }

    const create_ = create('button', 'menu-item menu-item--create');
    create_.type = 'button';
    create_.setAttribute('role', 'menuitem');
    create_.dataset.create = 'true';
    create_.innerHTML = icons.plus;
    create_.append(create('span', 'menu-label', strings.addMenu.newPlaylistWith));
    fragment.append(create_);

    this.menu.replaceChildren(fragment);
    this.menu.hidden = false;
    positionMenu(this.menu, anchor);
    this.menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  close(returnFocus = false): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    if (returnFocus) this.anchor?.focus();
    this.anchor = null;
  }
}
