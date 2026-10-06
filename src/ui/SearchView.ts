import type { Song } from '../core/Song';
import type { CoverCache } from './CoverCache';
import { byId } from './dom';
import { createSongRow } from './songRow';
import { strings } from './strings';

export type SearchSection = 'local' | 'spotify';

export type SpotifyResults =
  | { state: 'disconnected' }
  | { state: 'loading' }
  | { state: 'done'; songs: Song[] }
  | { state: 'error'; message: string };

export interface SearchRenderState {
  query: string;
  local: Song[];
  spotify: SpotifyResults;
  covers: CoverCache;
  loadedId: string | null;
  playing: boolean;
  isPlayable(song: Song): boolean;
}

export interface SearchHandlers {
  onPlay(section: SearchSection, index: number): void;
  onMenu(section: SearchSection, index: number, anchor: HTMLElement): void;
  onConnect(): void;
}

/** Main-panel search results: songs of the library and, when connected, Spotify's catalog. */
export class SearchView {
  private readonly title = byId('search-view-title');
  private readonly empty = byId('search-empty');
  private readonly localSection = byId('search-local-section');
  private readonly localList = byId<HTMLOListElement>('search-local');
  private readonly localState = byId('search-local-state');
  private readonly spotifyList = byId<HTMLOListElement>('search-spotify');
  private readonly spotifyState = byId('search-spotify-state');
  private readonly connectCard = byId('search-connect');

  constructor(handlers: SearchHandlers) {
    const bind = (list: HTMLElement, section: SearchSection) =>
      list.addEventListener('click', (event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>('.row');
        if (!row) return;
        const index = Number(row.dataset.index);
        const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
        if (action?.dataset.action === 'add') handlers.onMenu(section, index, action);
        else handlers.onPlay(section, index);
      });
    bind(this.localList, 'local');
    bind(this.spotifyList, 'spotify');
    byId('search-connect-btn').addEventListener('click', () => handlers.onConnect());
  }

  render(state: SearchRenderState): void {
    this.title.textContent = strings.search.resultsFor(state.query);
    const spotifySongs = state.spotify.state === 'done' ? state.spotify.songs : [];

    this.renderList(this.localList, state.local, state);
    this.localState.hidden = state.local.length > 0;
    this.localState.textContent = strings.search.noLocal;

    this.renderList(this.spotifyList, spotifySongs, state);
    this.connectCard.hidden = state.spotify.state !== 'disconnected';
    const spotifyMessage =
      state.spotify.state === 'loading'
        ? strings.search.loading
        : state.spotify.state === 'error'
          ? strings.search.error(state.spotify.message)
          : state.spotify.state === 'done' && spotifySongs.length === 0
            ? strings.search.noSpotify
            : '';
    this.spotifyState.textContent = spotifyMessage;
    this.spotifyState.hidden = !spotifyMessage;
    this.spotifyState.dataset.kind = state.spotify.state === 'error' ? 'error' : 'info';

    // Nothing anywhere: one clear message instead of two empty sections.
    const nothing = state.local.length === 0 && state.spotify.state === 'done' && spotifySongs.length === 0;
    this.empty.hidden = !nothing;
    this.empty.textContent = strings.search.nothing(state.query);
    this.localSection.hidden = nothing;
  }

  private renderList(list: HTMLOListElement, songs: readonly Song[], state: SearchRenderState): void {
    list.replaceChildren(
      ...songs.map((song, index) =>
        createSongRow(song, {
          index,
          isLoaded: song.id === state.loadedId,
          playing: state.playing,
          playable: state.isPlayable(song),
          covers: state.covers,
          actions: ['add'],
          draggable: false,
        }),
      ),
    );
    list.hidden = songs.length === 0;
  }
}
