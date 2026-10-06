import type { Song } from '../core/Song';
import type { CoverCache } from './CoverCache';
import { create, formatCounter } from './dom';
import { icons } from './icons';
import { strings } from './strings';

export type RowAction = 'add' | 'up' | 'down' | 'remove';

export interface SongRowOptions {
  /** Position in its list (shown as index + 1, and stored in data-index). */
  index: number;
  isLoaded: boolean;
  playing: boolean;
  /** False for Spotify songs while Spotify is not connected: shown disabled. */
  playable: boolean;
  covers: CoverCache;
  actions: readonly RowAction[];
  /** Label of the remove button (it differs between the library and a playlist). */
  removeLabel?: string;
  draggable: boolean;
}

/** One song row, shared by the playlist list and the search results. */
export function createSongRow(song: Song, options: SongRowOptions): HTMLLIElement {
  const { index, isLoaded, playing, playable } = options;
  const li = create('li', 'row');
  li.dataset.index = String(index);
  li.dataset.songId = song.id;
  li.draggable = options.draggable;
  li.dataset.search = `${song.title} ${song.artist} ${song.album}`.toLowerCase();
  if (isLoaded) {
    li.classList.add('is-current');
    li.setAttribute('aria-current', 'true');
  }
  if (!playable) {
    li.classList.add('is-unavailable');
    li.title = strings.spotify.connectToPlay;
  }

  const grip = create('span', 'row-grip');
  if (options.draggable) {
    grip.innerHTML = icons.grip;
    grip.title = strings.row.gripHint;
  }

  const pos = create('span', 'row-pos');
  if (isLoaded && playing) {
    pos.innerHTML = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>';
    pos.setAttribute('aria-label', strings.playing);
  } else if (isLoaded) {
    pos.textContent = '▶';
    pos.setAttribute('aria-hidden', 'true');
  } else {
    pos.textContent = String(index + 1).padStart(2, '0');
  }

  const coverUrl = options.covers.get(song);
  let cover: HTMLElement;
  if (coverUrl) {
    const img = create('img', 'row-cover');
    img.src = coverUrl;
    img.alt = '';
    img.loading = 'lazy';
    cover = img;
  } else {
    cover = create('span', 'row-cover row-cover--empty');
    cover.innerHTML = icons.note;
  }

  const main = create('button', 'row-main');
  main.type = 'button';
  main.dataset.action = 'play';
  main.setAttribute('aria-label', playable ? strings.row.play(song.title, song.artist, index + 1) : strings.spotify.connectToPlay);
  if (!playable) main.setAttribute('aria-disabled', 'true');
  const artist = create('span', 'row-artist');
  if (song.source === 'spotify') artist.append(spotifyMark());
  artist.append(create('span', 'row-artist-name', song.artist));
  main.append(create('span', 'row-title', song.title), artist);

  const album = create('span', 'row-album', song.album);
  const time = create('span', 'row-time', song.duration ? formatCounter(song.duration) : '–');

  const actions = create('div', 'row-actions');
  for (const action of options.actions) {
    if (action === 'add') actions.append(actionButton('add', icons.plus, strings.row.options(song.title)));
    else if (action === 'up') actions.append(actionButton('up', icons.up, strings.row.moveUp(song.title)));
    else if (action === 'down') actions.append(actionButton('down', icons.down, strings.row.moveDown(song.title)));
    else actions.append(actionButton('remove', icons.trash, options.removeLabel ?? strings.row.removeFromPlaylist(song.title)));
  }

  li.append(grip, pos, cover, main, album, time, actions);
  return li;
}

/** Small Spotify attribution badge shown before the artist of Spotify songs. */
export function spotifyMark(): HTMLElement {
  const mark = create('span', 'source-mark');
  mark.innerHTML = icons.spotifyBadge;
  mark.title = strings.spotify.mark;
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', strings.spotify.mark);
  return mark;
}

function actionButton(action: string, icon: string, label: string): HTMLButtonElement {
  const button = create('button', `row-btn row-btn--${action}`);
  button.type = 'button';
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon;
  return button;
}
