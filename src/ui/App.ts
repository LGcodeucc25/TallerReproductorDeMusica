import { advanceAfterEnd, extendIfAtEnd, type ContinuousSources } from '../core/continuousPlay';
import { PlaybackQueue } from '../core/PlaybackQueue';
import { Playlist, type RepeatMode, type SortKey } from '../core/Playlist';
import { ALL_SONGS_ID, PlaylistLibrary } from '../core/PlaylistLibrary';
import type { Song, SpotifySong } from '../core/Song';
import { LocalAudioEngine } from '../services/LocalAudioEngine';
import { LyricsService } from '../services/lyrics/LyricsService';
import { isAudioFile, readSong } from '../services/metadata';
import type { PlaybackEngine } from '../services/PlaybackEngine';
import { SongStore, type PersistedState, type ScreenView } from '../services/SongStore';
import { songFromTrack } from '../services/spotify/mapping';
import { SpotifySession } from '../services/spotify/session';
import { SpotifyEngine } from '../services/spotify/SpotifyEngine';
import { AddMenu } from './AddMenu';
import { Cassette } from './Cassette';
import { CoverCache } from './CoverCache';
import { byId, formatBytes } from './dom';
import { filesFromDrop, hasFiles } from './fileDrop';
import { Equalizer, type EqualizerSource } from './Equalizer';
import { HeaderView } from './HeaderView';
import { hydrateIcons, setIcon } from './icons';
import { LibraryPicker } from './LibraryPicker';
import { LyricsView, type LyricsState } from './LyricsView';
import { bindMediaSession, updateMediaSession } from './mediaSession';
import { nextUp } from './nextUp';
import { NowPlayingView, UPNEXT_LIMIT } from './NowPlayingView';
import { QueueView } from './QueueView';
import { SearchView, type SearchSection, type SpotifyResults } from './SearchView';
import { bindShortcuts } from './shortcuts';
import { SidebarView } from './SidebarView';
import { Splash } from './Splash';
import { describeSpotifyError, SpotifyPanel } from './SpotifyPanel';
import { strings } from './strings';
import { toast } from './toast';
import { Transport } from './Transport';

/** Repeat button cycle. */
const REPEAT_CYCLE: RepeatMode[] = ['all', 'one', 'off'];
/** Search starts after this pause in typing, with at least this many characters. */
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_CHARS = 2;
/** Library matches shown in the search view. */
const SEARCH_LOCAL_LIMIT = 50;
const SEARCH_PLAYLIST_ID = 'search-results';

type MainView = 'playlist' | 'search' | 'lyrics';

/** Lowercase without accents, so a query without accents still finds accented titles. */
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Connects the pieces. Three doubly linked lists hold the state:
 * the PlaylistLibrary (a list of playlists), each Playlist (a list of songs) and
 * the PlaybackQueue (an independent list of what plays next).
 * Views only draw them; a PlaybackEngine plays the current song (LocalAudioEngine for
 * imported files, SpotifyEngine for Spotify tracks) and the SongStore saves everything.
 */
export class App {
  private readonly library = new PlaylistLibrary({
    allSongs: strings.library.allSongs,
    newPlaylist: strings.library.newPlaylist,
  });
  private readonly queue = new PlaybackQueue();
  private readonly store = new SongStore();
  private readonly session = new SpotifySession(
    import.meta.env.VITE_SPOTIFY_CLIENT_ID?.trim(),
    // Must match a Redirect URI of the Spotify Dashboard exactly.
    `${window.location.origin}/`,
    strings.spotify.deviceName,
  );
  private readonly local = new LocalAudioEngine();
  private readonly spotifyEngine = new SpotifyEngine(this.session);
  /** The engine of the loaded song; the other one stays paused. */
  private engine: PlaybackEngine = this.local;
  private readonly lyrics = new LyricsService(this.store);
  private readonly covers = new CoverCache();
  private readonly compact = window.matchMedia('(max-width: 900px)');

  private transport!: Transport;
  private nowPlaying!: NowPlayingView;
  private sidebar!: SidebarView;
  private header!: HeaderView;
  private songList!: QueueView;
  private addMenu!: AddMenu;
  private picker!: LibraryPicker;
  private spotify!: SpotifyPanel;
  private search!: SearchView;
  private lyricsMain!: LyricsView;
  private lyricsStage!: LyricsView;
  /** Large (stage), compact (lyrics deck) and mini (dock) cassettes. */
  private cassettes: Cassette[] = [];
  private equalizers: Equalizer[] = [];

  /** Playlist open in the main view (independent from what is playing, like Spotify). */
  private viewed: Playlist = this.library.allSongs;
  /** "Repeat the playlist" is on by default. */
  private repeat: RepeatMode = 'all';
  /** The player screen ("now") or the library screen (playlists, with the dock). */
  private screen: ScreenView = 'now';
  /** Full screen: the player stage fills the window. */
  private full = false;
  private volume = 0.8;
  private muted = false;

  /** What the main panel shows, and where "back" goes from search and from lyrics. */
  private mainView: MainView = 'playlist';
  private viewBeforeSearch: MainView = 'playlist';
  private viewBeforeLyrics: MainView = 'playlist';
  private screenBeforeSearch: ScreenView = 'library';
  private screenBeforeLyrics: ScreenView = 'now';

  private searchQuery = '';
  private searchLocal: Song[] = [];
  private searchSpotify: SpotifyResults = { state: 'disconnected' };
  private searchTimer = 0;
  /** Increases on every search, so late Spotify answers are ignored. */
  private searchToken = 0;
  /** Temporary source of a queue started from search results (not in the library). */
  private searchPlaylist: Playlist | null = null;

  private lyricsState: LyricsState = { kind: 'idle' };
  private lyricsSongId: string | null = null;
  private lyricsToken = 0;

  /** Spotify songs skipped while disconnected are announced once. */
  private skipNoticeShown = false;
  /** Position restored from the last session, used when its song can finally load. */
  private pendingStartAt = 0;

  private loadedId: string | null = null;
  private wantsPlay = false;
  private restoring = true;
  /** True while the queue follows a library change, so the change is drawn once. */
  private syncingQueue = false;
  private persistTimer = 0;
  /** The queue on the player screen takes the whole right column. */
  private queueExpanded = false;
  private lastPositionSave = 0;
  private storageAvailable = true;
  /** Nesting of dragenter/dragleave while files are dragged over the page. */
  private fileDragDepth = 0;

  async start(): Promise<void> {
    const splash = new Splash(byId('splash'));
    hydrateIcons();
    this.createViews();

    this.queue.setPlayable((song) => this.isPlayable(song));
    this.bindEngines();
    this.bindImport();
    this.bindSearch();
    this.bindChrome();
    this.bindDialogs();
    this.bindShortcutsAndMedia();
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.full) this.setFull(false);
    });

    this.library.subscribe(() => this.onLibraryChange());
    this.queue.subscribe(() => this.onQueueChange());
    this.session.subscribe(() => this.onSpotifyChange());

    // The splash stays until the library is restored (between its minimum and maximum time).
    const restoring = this.restore();
    void splash.hideWhen(restoring);
    await restoring;
    this.restoring = false;
    this.extendQueueIfAtEnd();
    this.applyVolume();
    this.applyView();
    this.render();
    void this.updateStorageMeter();
    void this.session.start();
  }

  private createViews(): void {
    this.transport = new Transport({
      onToggle: () => this.togglePlay(),
      onNext: () => this.next(),
      onPrevious: () => this.previous(),
      onRepeat: () => this.cycleRepeat(),
      onShuffle: () => this.toggleShuffle(),
      onSeek: (seconds) => this.engine.seek(seconds),
      onVolume: (volume) => {
        this.volume = volume;
        this.muted = false;
        this.applyVolume();
        this.schedulePersist();
      },
      onToggleMute: () => {
        this.muted = !this.muted;
        this.applyVolume();
      },
    });
    this.nowPlaying = new NowPlayingView({
      onOpenSource: () => {
        const source = this.source();
        if (source && this.library.get(source.id)) this.openPlaylist(source.id);
        else this.showScreen('library');
      },
      onMinimize: () => this.showScreen('library'),
      onAddCurrent: (anchor) => {
        const song = this.queue.current;
        if (song) this.openMenu(anchor, song);
      },
      onPickUpcoming: (songId) => this.playAfter(() => this.queue.selectById(songId)),
      onMoveUpcoming: (songId, refSongId, where) => this.queue.moveSong(songId, refSongId, where),
      onReshuffle: () => {
        if (this.queue.reshuffleUpcoming()) toast(strings.stage.reshuffled);
      },
      onQueueExpanded: (expanded) => {
        this.queueExpanded = expanded;
        this.schedulePersist();
      },
    });
    for (const [size, id] of [['large', 'stage-cassette'], ['compact', 'lyrics-cassette'], ['mini', 'dock-cassette']] as const) {
      const cassette = new Cassette(size);
      byId(id).append(cassette.element);
      this.cassettes.push(cassette);
    }
    const eqSource: EqualizerSource = {
      playing: () => !this.engine.paused,
      // Local songs: the real spectrum from the analyser.
      analyser: () => (this.engine === this.local ? this.local.analyser : null),
      // Spotify audio cannot be read (DRM): a procedural motion seeded with the track id.
      proceduralSeed: () => {
        const song = this.queue.current;
        return this.engine === this.spotifyEngine && song?.source === 'spotify' ? song.spotifyId : null;
      },
    };
    this.equalizers = [
      new Equalizer(byId<HTMLCanvasElement>('stage-eq'), eqSource, {
        columns: () => (this.compact.matches ? 40 : 64),
        segment: 4,
        segmentGap: 2,
        columnGap: 3,
      }),
      new Equalizer(byId<HTMLCanvasElement>('dock-eq'), eqSource, { columns: () => 24, segment: 2, segmentGap: 1, columnGap: 2 }),
    ];
    this.sidebar = new SidebarView({
      onOpen: (id) => this.openPlaylist(id),
      onCreate: (name) => this.createPlaylist(name),
      onMove: (from, to) => this.library.move(from, to),
      onDropSong: (playlistId, songId) => this.addSongTo(playlistId, songId),
    });
    this.header = new HeaderView({
      onPlay: () => this.playViewed(),
      onReverse: () => this.reverseViewed(),
      onSort: (key) => this.sortViewed(key),
      onAddFromLibrary: () => void this.addFromLibrary(),
      onRename: (name) => this.renameViewed(name),
      onDelete: () => this.deleteViewed(),
      onClear: () => void this.clearViewed(),
    });
    this.songList = new QueueView({
      onPlay: (index) => this.playFromViewed(index),
      onRemove: (index) => this.removeFromViewed(index),
      onMove: (from, to) => this.viewed.move(from, to),
      onAddTo: (songId, anchor) => {
        const song = this.findSong(songId);
        if (song) this.openMenu(anchor, song);
      },
      onDropFiles: (files, slot) => {
        this.endFileDrag();
        void this.importFiles(files, slot);
      },
    });
    this.addMenu = new AddMenu({
      onPlayNext: (song) => this.playNext(song),
      onSave: (song) => this.saveFromMenu(song),
      onAdd: (playlistId, song) => this.addSongTo(playlistId, song),
      onCreateWith: (song) => this.createPlaylistWith(song),
    });
    this.picker = new LibraryPicker();
    this.spotify = new SpotifyPanel(this.session, () => this.showScreen('library'));
    this.search = new SearchView({
      onPlay: (section, index) => this.playSearchResult(section, index),
      onMenu: (section, index, anchor) => {
        const song = this.searchSongs(section)[index];
        if (song) this.openMenu(anchor, song);
      },
      onConnect: () => this.spotify.connect(),
    });
    const lyricsHandlers = {
      onSeek: (seconds: number) => this.engine.seek(seconds),
      onRetry: () => this.loadLyrics(true),
    };
    const timeMs = () => this.engine.currentTime * 1000;
    const mainLyrics = byId('lyrics-view');
    this.lyricsMain = new LyricsView(mainLyrics, mainLyrics, lyricsHandlers, timeMs);
    const stageLyrics = byId('stage-lyrics');
    this.lyricsStage = new LyricsView(stageLyrics, stageLyrics, lyricsHandlers, timeMs);
  }

  /** Spotify songs need a connected Premium account; local files always play. */
  private isPlayable(song: Song): boolean {
    return song.source === 'local' || this.session.canPlay;
  }

  private openMenu(anchor: HTMLElement, song: Song): void {
    this.addMenu.open(anchor, song, { library: this.library, nowPlayingId: this.loadedId });
  }

  /** The playlist the queue was loaded from, if it still exists. */
  /** Continuous playback takes songs from the whole library, then from the playlist that is playing. */
  private continuousSources(): ContinuousSources {
    const library = this.library.allSongs.songs;
    return { library, source: this.source()?.songs ?? library };
  }

  /** With repeat 'off' and the last song current, appends more songs now (returns whether it did). */
  private extendQueueIfAtEnd(): boolean {
    return extendIfAtEnd(this.queue, this.repeat, this.continuousSources());
  }

  private source(): Playlist | null {
    const id = this.queue.sourceId;
    if (!id) return null;
    if (id === this.searchPlaylist?.id) return this.searchPlaylist;
    return this.library.get(id);
  }

  // ---- State → UI ----

  /** A playlist changed: the queue follows its source, then everything is drawn once. */
  private onLibraryChange(): void {
    if (this.restoring) return;
    this.syncingQueue = true;
    try {
      const source = this.source();
      if (source) {
        this.queue.syncWith(source);
      } else if (this.queue.sourceId) {
        // The source playlist was deleted: keep playing from the whole library.
        this.queue.load(this.library.allSongs, this.queue.current?.id ?? null, this.queue.shuffle);
      } else if (this.library.allSongs.size > 0) {
        // Nothing was ever loaded (first import): queue the library so play works right away.
        this.queue.load(this.library.allSongs, null, this.queue.shuffle);
      }
    } finally {
      this.syncingQueue = false;
    }
    this.refresh();
  }

  private onQueueChange(): void {
    if (this.restoring || this.syncingQueue) return;
    this.refresh();
  }

  /** Redraw, load the current song if it changed, and save. */
  private refresh(): void {
    // Continuous playback appended songs: their queue change already ran a full refresh.
    if (this.extendQueueIfAtEnd()) return;
    this.render();
    this.syncTrack(this.wantsPlay);
    if (this.queue.lastSkipped > 0) this.noticeSkipped();
    this.schedulePersist();
  }

  private render(): void {
    const song = this.queue.current;
    const coverUrl = this.covers.get(song);
    const playing = !this.engine.paused;
    const isLibrary = this.viewed === this.library.allSongs;
    const sourceId = this.queue.sourceId;

    const upNext = nextUp({
      current: song,
      repeat: this.repeat,
      following: this.queue.peekNext(this.repeat),
      upcoming: this.queue.upcoming(UPNEXT_LIMIT, this.repeat),
    });

    this.transport.renderTrack(song);
    this.transport.renderControls({
      hasSong: !!song,
      hasNext: upNext.canSkip,
      repeat: this.repeat,
      shuffle: this.queue.shuffle,
    });
    this.nowPlaying.render({
      queue: this.queue,
      sourceName: this.source()?.name ?? null,
      repeat: this.repeat,
      covers: this.covers,
      upNext,
    });
    this.sidebar.render(this.library, this.viewed.id, sourceId ?? '', playing);
    this.header.render(this.viewed, this.viewed.id === sourceId, playing);
    this.songList.render(this.viewed, {
      covers: this.covers,
      loadedId: this.loadedId,
      playing,
      isLibrary,
      isPlayable: (candidate) => this.isPlayable(candidate),
    });
    if (this.mainView === 'search') this.renderSearch();
    this.renderLyrics();
    this.renderCassettes();
    for (const equalizer of this.equalizers) equalizer.wake();
    updateMediaSession(song, coverUrl, playing);
  }

  /** The three cassettes: label, tape spools from the progress, reels spinning while playing. */
  private renderCassettes(): void {
    const song = this.queue.current;
    const duration = this.engine.duration || song?.duration || 0;
    const state = {
      title: song?.title ?? strings.nothingPlaying,
      subtitle: song ? strings.cassette.subtitle(song.artist, this.source()?.name ?? null) : '',
      progress: duration ? this.engine.currentTime / duration : 0,
      playing: !!song && !this.engine.paused,
      label: song ? strings.cassette.playing(song.title) : strings.cassette.empty,
    };
    for (const cassette of this.cassettes) cassette.update(state);
  }

  /** Loads the current song of the queue when it changed. */
  private syncTrack(autoplay: boolean, startAt = 0): void {
    const song = this.queue.current;
    const id = song?.id ?? null;
    if (id === this.loadedId) return;
    this.loadedId = id;

    if (!song) {
      this.engine.unload();
      this.wantsPlay = false;
      this.transport.renderProgress(0, 0);
      return;
    }
    if (!this.isPlayable(song)) {
      // A Spotify song while disconnected: nothing to load (it loads once Spotify connects).
      this.engine.unload();
      this.wantsPlay = false;
      this.pendingStartAt = startAt;
      this.transport.renderProgress(startAt, song.duration);
      return;
    }
    const engine = song.source === 'spotify' ? this.spotifyEngine : this.local;
    if (engine !== this.engine) {
      // Switching sources: the other engine must never keep sounding.
      this.engine.pause();
      this.engine.unload();
      this.engine = engine;
      this.applyVolume();
    }
    this.pendingStartAt = 0;
    engine.load(song, startAt);
    this.transport.renderProgress(startAt, song.duration);
    if (autoplay) void engine.play();
  }

  /**
   * Runs a change that picks a song to play (from a click). If the loaded song did
   * not change, it resumes it. The Spotify player is activated first, inside the click.
   */
  private playAfter(change: () => void): void {
    this.session.activate();
    this.wantsPlay = true;
    const before = this.loadedId;
    change();
    if (this.loadedId === before && this.engine.paused && this.queue.current && this.isPlayable(this.queue.current)) {
      void this.engine.play();
    }
  }

  private noticeSkipped(): void {
    if (this.skipNoticeShown) return;
    this.skipNoticeShown = true;
    toast(strings.spotify.skipped);
  }

  // ---- Transport ----

  private togglePlay(): void {
    this.session.activate();
    const current = this.queue.current;
    if (!current) {
      if (this.viewed.size > 0) this.playViewed();
      else toast(strings.transport.importFirst);
      return;
    }
    if (!this.isPlayable(current)) {
      // Disconnected Spotify song: jump to the next song that can play.
      this.wantsPlay = true;
      if (!this.queue.next('all')) toast(strings.spotify.connectToPlay);
      return;
    }
    if (this.engine.paused) {
      this.wantsPlay = true;
      this.syncTrack(false);
      void this.engine.play();
    } else {
      this.wantsPlay = false;
      this.engine.pause();
    }
  }

  /** Big play button of the open playlist: resume it if it is already playing, otherwise start it. */
  private playViewed(): void {
    if (this.viewed.id === this.queue.sourceId && this.queue.current) {
      this.togglePlay();
      return;
    }
    if (this.viewed.size === 0) return;
    const playlist = this.viewed;
    this.playAfter(() => this.queue.load(playlist, null, this.queue.shuffle));
  }

  /** Clicking a song of the open playlist loads the queue from that playlist, starting at it. */
  private playFromViewed(index: number): void {
    const song = this.viewed.songs.traverseToIndex(index)?.value;
    if (!song) return;
    if (!this.isPlayable(song)) {
      toast(strings.spotify.connectToPlay);
      return;
    }
    const playlist = this.viewed;
    this.playAfter(() => this.queue.load(playlist, song.id, this.queue.shuffle));
  }

  private next(): void {
    if (!this.queue.current) return;
    this.session.activate();
    const previousId = this.loadedId;
    const song = this.queue.next(this.repeat);
    // With repeat 'one' the next song is the same one (as the next-song card shows), even after the last song.
    if (!song && this.repeat === 'one') this.engine.seek(0);
    else if (!song) toast(strings.transport.lastSong);
    else if (song.id === previousId) this.engine.seek(0);
  }

  /** Restarts the song if it is past 3 s, otherwise goes to the previous one. */
  private previous(): void {
    if (!this.queue.current) return;
    this.session.activate();
    if (this.engine.currentTime > 3) {
      this.engine.seek(0);
      return;
    }
    const previousId = this.loadedId;
    const song = this.queue.previous(this.repeat);
    if (!song) {
      this.engine.seek(0);
      toast(strings.transport.firstSong);
    } else if (song.id === previousId) {
      this.engine.seek(0);
    }
  }

  /** Any engine reported the end of the song: the shared flow picks what plays next. */
  private onEnded(): void {
    // The song played to its end, so playback goes on even if it was started outside
    // this app (for example resumed from another Spotify device).
    this.wantsPlay = true;
    const outcome = advanceAfterEnd(this.queue, this.repeat, this.loadedId, this.continuousSources());
    if (outcome.kind === 'stop') {
      this.wantsPlay = false;
      this.engine.seek(0);
      this.render();
    } else if (outcome.kind === 'replay') {
      this.engine.seek(0);
      void this.engine.play();
    }
    // 'next': the queue change already loaded the song and started it (syncTrack).
  }

  private cycleRepeat(): void {
    this.repeat = REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(this.repeat) + 1) % REPEAT_CYCLE.length];
    toast(strings.repeatToasts[this.repeat]);
    if (!this.extendQueueIfAtEnd()) this.render();
    this.schedulePersist();
  }

  /** Shuffle changes the queue only; the playlists keep their order. */
  private toggleShuffle(): void {
    const on = !this.queue.shuffle;
    this.queue.setShuffle(on, this.source());
    toast(on ? strings.shuffleOn : strings.shuffleOff);
  }

  // ---- Screens: player, library (with the dock), full screen ----

  private bindChrome(): void {
    byId('nav-now').addEventListener('click', () => this.showScreen('now'));
    byId('nav-library').addEventListener('click', () => this.showScreen('library'));
    byId('lyrics-back-btn').addEventListener('click', () => this.closeLyrics('now'));
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-lyrics-toggle]')) this.toggleLyrics();
      else if (target.closest('[data-fullscreen-toggle]')) this.setFull(!this.full);
      else if (target.closest('[data-expand]')) this.showScreen('now');
    });
  }

  private showScreen(screen: ScreenView): void {
    if (this.mainView === 'lyrics') this.mainView = this.viewBeforeLyrics;
    if (screen === 'library' && this.full) this.setFull(false);
    this.screen = screen;
    this.applyView();
    this.schedulePersist();
  }

  private setFull(full: boolean): void {
    if (full === this.full) return;
    this.full = full;
    if (full) {
      this.screen = 'now';
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    }
    this.applyView();
  }

  // ---- Playlists ----

  private openPlaylist(id: string): void {
    const playlist = this.library.get(id);
    if (!playlist) return;
    // Opening a playlist shows the library and leaves the search and lyrics views.
    if (this.full) this.setFull(false);
    this.screen = 'library';
    if (this.mainView !== 'playlist') this.showPlaylistView();
    else this.applyView();
    if (playlist === this.viewed) {
      this.render();
      this.schedulePersist();
      return;
    }
    this.viewed = playlist;
    this.header.reset();
    byId('main').scrollTo({ top: 0 });
    this.render();
    this.schedulePersist();
  }

  private createPlaylist(name: string): Playlist {
    const playlist = this.library.create(name);
    this.openPlaylist(playlist.id);
    toast(strings.playlists.created(playlist.name), 'success');
    return playlist;
  }

  private createPlaylistWith(found: Song): void {
    const name = window.prompt(strings.playlists.newNamePrompt, this.library.defaultName());
    if (name === null) return;
    // A Spotify result is saved to the library (the all-songs playlist) first.
    const [song] = this.saveSongs([found]);
    const playlist = this.library.create(name);
    this.library.addToPlaylist(playlist.id, [song]);
    toast(strings.playlists.createdWith(playlist.name, song.title), 'success');
  }

  /** From the menu or a drop on the sidebar; a Spotify result is saved to the library too. */
  private addSongTo(playlistId: string, target: Song | string): void {
    const found = typeof target === 'string' ? this.findSong(target) : target;
    const playlist = this.library.get(playlistId);
    if (!found || !playlist || playlist.id === ALL_SONGS_ID) return;
    const [song] = this.saveSongs([found]);
    const { added } = this.library.addToPlaylist(playlistId, [song]);
    toast(
      added ? strings.playlists.added(song.title, playlist.name) : strings.playlists.alreadyIn(song.title, playlist.name),
      added ? 'success' : 'info',
    );
  }

  /** "Play next": the song goes right after the current one in the queue; playlists are not touched. */
  private playNext(found: Song): void {
    const song = this.findSong(found.id) ?? found;
    const after = this.queue.current;
    this.queue.playNext(song);
    toast(strings.playlists.playNext(song.title, after?.title ?? null), 'success');
  }

  private async addFromLibrary(): Promise<void> {
    const target = this.viewed;
    const songs = await this.picker.pick(this.library.allSongs, target, this.covers);
    if (songs.length === 0) return;
    const { added } = this.library.addToPlaylist(target.id, songs);
    toast(strings.playlists.addedMany(added, target.name), 'success');
  }

  private renameViewed(name: string): void {
    const old = this.viewed.name;
    if (!this.library.rename(this.viewed.id, name)) {
      toast(strings.playlists.nameRequired, 'error');
      return;
    }
    if (old !== this.viewed.name) toast(strings.playlists.renamed(this.viewed.name));
  }

  /** If the deleted playlist was playing, the queue continues from the whole library (see onLibraryChange). */
  private deleteViewed(): void {
    const playlist = this.viewed;
    if (playlist.id === ALL_SONGS_ID) return;
    if (!window.confirm(strings.playlists.confirmDelete(playlist.name))) return;
    this.viewed = this.library.allSongs;
    this.header.reset();
    this.library.remove(playlist.id);
    toast(strings.playlists.deleted(playlist.name));
  }

  private reverseViewed(): void {
    if (this.viewed.size < 2) return;
    this.viewed.reverse();
    toast(strings.playlists.reversed(this.viewed.name));
  }

  private sortViewed(key: SortKey): void {
    if (this.viewed.size < 2) return;
    this.viewed.sortBy(key);
    toast(strings.playlists.sorted(key), 'success');
  }

  private removeFromViewed(index: number): void {
    const song = this.viewed.songs.traverseToIndex(index)?.value;
    if (!song) return;

    if (this.viewed !== this.library.allSongs) {
      this.viewed.removeAt(index);
      toast(strings.removal.removedFromPlaylist(song.title, this.viewed.name));
      return;
    }

    const inPlaylists = this.library.containing(song.id);
    if (inPlaylists.length > 0) {
      const names = inPlaylists.map((playlist) => playlist.name);
      if (!window.confirm(strings.removal.confirmDeleteEverywhere(song.title, names))) return;
    }
    this.library.removeSongEverywhere(song.id);
    this.queue.removeById(song.id); // also when it was only in the queue (added with "play next")
    this.covers.release(song.id);
    void this.store.deleteSong(song.id).then(() => this.updateStorageMeter(), () => undefined);
    toast(strings.removal.deletedFromLibrary(song.title));
  }

  private async clearViewed(): Promise<void> {
    const playlist = this.viewed;
    if (playlist.size === 0) return;

    if (playlist !== this.library.allSongs) {
      if (!window.confirm(strings.removal.confirmClearPlaylist(playlist.name))) return;
      playlist.clear();
      toast(strings.removal.playlistCleared(playlist.name));
      return;
    }

    if (!window.confirm(strings.removal.confirmClearLibrary)) return;
    this.wantsPlay = false;
    this.library.clearLibrary();
    this.queue.clear();
    this.covers.releaseAll();
    try {
      await this.store.clearSongs();
    } catch {
      /* storage unavailable: nothing to clear */
    }
    void this.updateStorageMeter();
    toast(strings.removal.libraryCleared);
  }

  /** A song by id: in the library, else in the queue or the search results (Spotify songs not saved). */
  private findSong(songId: string): Song | null {
    const match = (song: Song) => song.id === songId;
    return (
      this.library.allSongs.songs.findNode(match)?.value ??
      this.queue.songs.findNode(match)?.value ??
      [...this.searchLocal, ...this.searchSongs('spotify')].find(match) ??
      null
    );
  }

  /** Adds songs to the library (no duplicates) and stores the new ones; returns the library's objects. */
  private saveSongs(songs: Song[]): Song[] {
    const { songs: saved, added } = this.library.saveToLibrary(songs);
    if (added.length > 0 && this.storageAvailable) {
      void Promise.all(added.map((song) => this.store.putSong(song)))
        .catch(() => undefined)
        .then(() => this.updateStorageMeter());
    }
    return saved;
  }

  private saveFromMenu(song: Song): void {
    const already = this.library.allSongs.has(song.id);
    this.saveSongs([song]);
    toast(already ? strings.search.alreadySaved(song.title) : strings.search.saved(song.title), already ? 'info' : 'success');
  }

  // ---- Main views: playlist, search, lyrics ----

  private applyView(): void {
    const lyricsOpen = this.mainView === 'lyrics';
    const body = document.body;
    body.dataset.screen = this.screen;
    body.dataset.main = this.mainView;
    body.dataset.full = String(this.full);
    body.dataset.lyrics = lyricsOpen ? 'on' : 'off';

    byId('now-screen').hidden = this.screen !== 'now' && !this.full;
    byId('library-screen').hidden = this.screen !== 'library' || this.full;
    byId('playlist-view').hidden = this.mainView !== 'playlist';
    byId('search-view').hidden = this.mainView !== 'search';
    byId('lyrics-screen').hidden = !lyricsOpen || this.full;

    // The lyrics belong to the player: its tab stays current while they are open.
    const nowCurrent = this.screen === 'now' || lyricsOpen;
    byId('nav-now').toggleAttribute('aria-current', nowCurrent);
    byId('nav-library').toggleAttribute('aria-current', !nowCurrent);
    if (nowCurrent) byId('nav-now').setAttribute('aria-current', 'page');
    else byId('nav-library').setAttribute('aria-current', 'page');

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lyrics-toggle]')) {
      button.setAttribute('aria-pressed', String(lyricsOpen));
      if (button.classList.contains('round-btn')) {
        button.setAttribute('aria-label', lyricsOpen ? strings.views.lyricsOn : strings.views.lyricsOff);
        button.title = button.getAttribute('aria-label')!;
      }
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-fullscreen-toggle]')) {
      setIcon(button, this.full ? 'collapse' : 'expand');
      const label = this.full ? strings.views.exitFullScreen : strings.views.fullScreen;
      button.setAttribute('aria-label', label);
      button.title = label;
    }
    this.lyricsMain.setVisible(lyricsOpen && !this.full);
    this.lyricsStage.setVisible(lyricsOpen && this.full);
    for (const equalizer of this.equalizers) equalizer.wake();
  }

  private setMainView(view: MainView): void {
    if (view === this.mainView) return;
    this.mainView = view;
    byId('main').scrollTo({ top: 0 });
    this.applyView();
  }

  private showPlaylistView(): void {
    const input = byId<HTMLInputElement>('global-search');
    input.value = '';
    window.clearTimeout(this.searchTimer);
    this.setMainView('playlist');
  }

  /** The lyrics buttons: open the lyrics without touching playback; pressed again, they go back. */
  private toggleLyrics(): void {
    if (this.mainView === 'lyrics') {
      this.closeLyrics();
      return;
    }
    this.viewBeforeLyrics = this.mainView;
    this.screenBeforeLyrics = this.screen;
    this.mainView = 'lyrics';
    // In full screen the lyrics replace the cassette on the stage; otherwise they take the library area.
    if (!this.full) this.screen = 'library';
    this.applyView();
    this.loadLyrics();
    this.renderLyrics();
  }

  private closeLyrics(screen: ScreenView = this.screenBeforeLyrics): void {
    if (this.mainView !== 'lyrics') return;
    this.mainView = this.viewBeforeLyrics;
    this.screen = screen;
    this.applyView();
  }

  private loadLyrics(force = false): void {
    const song = this.queue.current;
    if (!song) {
      this.lyricsSongId = null;
      this.lyricsState = { kind: 'idle' };
      return;
    }
    if (!force && song.id === this.lyricsSongId) return;
    this.lyricsSongId = song.id;
    this.lyricsState = { kind: 'loading' };
    const token = ++this.lyricsToken;
    this.lyrics
      .get(song)
      .then((content) => {
        if (token === this.lyricsToken) this.lyricsState = { kind: 'content', content };
      })
      .catch(() => {
        if (token === this.lyricsToken) this.lyricsState = { kind: 'error' };
      })
      .finally(() => {
        if (token === this.lyricsToken) this.renderLyrics();
      });
  }

  private renderLyrics(): void {
    if (this.mainView !== 'lyrics') return;
    if ((this.queue.current?.id ?? null) !== this.lyricsSongId) this.loadLyrics();
    const key = `${this.lyricsSongId ?? ''}#${this.lyricsToken}`;
    this.lyricsMain.render(key, this.lyricsState);
    this.lyricsStage.render(key, this.lyricsState);
  }

  // ---- Search ----

  private bindSearch(): void {
    const input = byId<HTMLInputElement>('global-search');
    byId('global-search-form').addEventListener('submit', (event) => {
      event.preventDefault();
      window.clearTimeout(this.searchTimer);
      this.onSearchInput(input.value);
    });
    input.addEventListener('input', () => {
      window.clearTimeout(this.searchTimer);
      // Clearing the field goes back at once; typing waits for a pause.
      if (!input.value.trim()) this.onSearchInput('');
      else this.searchTimer = window.setTimeout(() => this.onSearchInput(input.value), SEARCH_DEBOUNCE_MS);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      input.value = '';
      this.onSearchInput('');
    });
  }

  private onSearchInput(text: string): void {
    const query = text.trim();
    if (query.length < SEARCH_MIN_CHARS) {
      if (this.mainView === 'search') {
        // Back to where the search started.
        this.mainView = this.viewBeforeSearch;
        this.screen = this.screenBeforeSearch;
        this.applyView();
      }
      return;
    }
    if (this.mainView !== 'search') {
      this.viewBeforeSearch = this.mainView === 'lyrics' ? this.viewBeforeLyrics : this.mainView;
      this.screenBeforeSearch = this.mainView === 'lyrics' ? this.screenBeforeLyrics : this.screen;
    }
    // Results show in the library area.
    if (this.full) this.setFull(false);
    this.screen = 'library';
    this.setMainView('search');
    this.applyView();
    this.runSearch(query);
  }

  private runSearch(query: string): void {
    this.searchQuery = query;
    const needle = normalize(query);
    this.searchLocal = [...this.library.allSongs.songs]
      .filter((song) => normalize(`${song.title} ${song.artist} ${song.album}`).includes(needle))
      .slice(0, SEARCH_LOCAL_LIMIT);

    const token = ++this.searchToken;
    if (!this.session.isLoggedIn || !this.session.api) {
      this.searchSpotify = { state: 'disconnected' };
    } else {
      this.searchSpotify = { state: 'loading' };
      this.session.api
        .searchTracks(query)
        .then((tracks) => {
          if (token !== this.searchToken) return;
          // The same track already in the library is the same Song object (id "spotify:<id>").
          const songs = tracks.map((track) => {
            const song = songFromTrack(track);
            return this.library.allSongs.songs.findNode((saved) => saved.id === song.id)?.value ?? song;
          });
          this.searchSpotify = { state: 'done', songs };
        })
        .catch((error: unknown) => {
          if (token === this.searchToken) this.searchSpotify = { state: 'error', message: describeSpotifyError(error) };
        })
        .finally(() => {
          if (token === this.searchToken) this.renderSearch();
        });
    }
    this.renderSearch();
  }

  private searchSongs(section: SearchSection): Song[] {
    if (section === 'local') return this.searchLocal;
    return this.searchSpotify.state === 'done' ? this.searchSpotify.songs : [];
  }

  private renderSearch(): void {
    if (this.mainView !== 'search') return;
    this.search.render({
      query: this.searchQuery,
      local: this.searchLocal,
      spotify: this.searchSpotify,
      covers: this.covers,
      loadedId: this.loadedId,
      playing: !this.engine.paused,
      isPlayable: (song) => this.isPlayable(song),
    });
  }

  /** Plays a result: the queue is the visible results of that section, from the clicked song. */
  private playSearchResult(section: SearchSection, index: number): void {
    const songs = this.searchSongs(section);
    const song = songs[index];
    if (!song) return;
    if (!this.isPlayable(song)) {
      toast(strings.spotify.connectToPlay);
      return;
    }
    const results = new Playlist(SEARCH_PLAYLIST_ID, strings.search.sourceName);
    results.addMany(songs);
    this.searchPlaylist = results;
    this.playAfter(() => this.queue.load(results, song.id, this.queue.shuffle));
  }

  // ---- Spotify connection ----

  private onSpotifyChange(): void {
    // A new connection state may change which songs play: announce skips again if needed.
    this.skipNoticeShown = false;
    this.queue.setPlayable((song) => this.isPlayable(song));
    const current = this.queue.current;
    // A Spotify song that could not load before (disconnected) loads now.
    if (current?.source === 'spotify' && this.session.canPlay && this.engine !== this.spotifyEngine) {
      this.loadedId = null;
      this.syncTrack(false, this.pendingStartAt);
    }
    if (this.mainView === 'search' && this.searchQuery && (this.searchSpotify.state === 'disconnected') === this.session.isLoggedIn) {
      this.runSearch(this.searchQuery);
    }
    // Songs that can play now may let continuous playback go on.
    if (!this.restoring && !this.extendQueueIfAtEnd()) this.render();
  }

  // ---- Import ----

  private bindImport(): void {
    const fileInput = byId<HTMLInputElement>('file-input');
    const folderInput = byId<HTMLInputElement>('folder-input');
    byId('import-btn').addEventListener('click', () => fileInput.click());
    byId('import-folder-btn').addEventListener('click', () => folderInput.click());

    for (const input of [fileInput, folderInput]) {
      input.addEventListener('change', () => {
        const files = Array.from(input.files ?? []);
        input.value = '';
        if (files.length) void this.importFiles(files);
      });
    }

    // Files dropped outside the song list are added at the end. Over the list,
    // the QueueView shows the exact gap and handles the drop itself.
    const overlay = byId('drop-overlay');
    const dropText = byId('drop-text');
    const overList = (event: DragEvent) =>
      !byId('queue-list').hidden && !!(event.target as Element | null)?.closest?.('#queue-list');
    window.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      this.fileDragDepth++;
      dropText.textContent = strings.importing.dropHere(this.viewed.name, this.viewed.size > 0);
      overlay.hidden = overList(event);
    });
    window.addEventListener('dragleave', (event) => {
      if (!hasFiles(event)) return;
      this.fileDragDepth = Math.max(0, this.fileDragDepth - 1);
      if (this.fileDragDepth === 0) overlay.hidden = true;
    });
    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      overlay.hidden = overList(event);
    });
    window.addEventListener('drop', (event) => {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      this.endFileDrag();
      void filesFromDrop(event.dataTransfer).then((files) => this.importFiles(files));
    });
  }

  private endFileDrag(): void {
    this.fileDragDepth = 0;
    byId('drop-overlay').hidden = true;
  }

  /** Where the songs went, in words: no positions or indices. */
  private describePlace(slot: number | undefined, sizeBefore: number, count: number, target: string): string {
    if (slot === undefined || slot >= sizeBefore) return strings.importing.placeEnd(target);
    if (slot <= 0) return strings.importing.placeStart(target);
    return strings.importing.placeDropped(target, count);
  }

  /** `slot`: gap of the open playlist where the songs go (omitted = at the end). */
  private async importFiles(files: File[], slot?: number): Promise<void> {
    const audio = files
      .filter(isAudioFile)
      .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, 'es', { numeric: true }));
    const skipped = files.length - audio.length;

    if (audio.length === 0) {
      toast(strings.importing.noAudio, 'error');
      return;
    }

    const target = this.viewed;
    const songs: Song[] = [];
    for (const [i, file] of audio.entries()) {
      toast(strings.importing.reading(i + 1, audio.length, file.name), 'info', true);
      songs.push(await readSong(file, strings.library.unknownArtist));
    }

    const isLibrary = target === this.library.allSongs;
    const targetName = isLibrary ? strings.library.yourLibrary : strings.importing.playlistTarget(target.name);
    const place = this.describePlace(slot, target.size, songs.length, targetName);
    this.library.importSongs(songs, target.id, slot);

    let unsaved = 0;
    if (this.storageAvailable) {
      for (const song of songs) {
        try {
          await this.store.putSong(song);
        } catch {
          unsaved++;
        }
      }
      void navigator.storage?.persist?.();
    } else {
      unsaved = songs.length;
    }

    const messages = [
      strings.importing.added(songs.length, place, !isLibrary),
      skipped ? strings.importing.skipped(skipped) : '',
      unsaved ? strings.importing.unsaved(unsaved) : '',
    ].filter(Boolean);
    toast(messages.join(' '), unsaved ? 'error' : 'success');
    void this.updateStorageMeter();
  }

  // ---- Persistence ----

  private async restore(): Promise<void> {
    try {
      const [state, songs] = await Promise.all([this.store.loadState(), this.store.getSongs()]);
      if (state) {
        this.repeat = state.repeat;
        this.volume = state.volume;
        this.screen = state.view;
        this.queueExpanded = state.queueExpanded ?? false;
        this.nowPlaying.setQueueExpanded(this.queueExpanded);
      }

      this.library.batch(() => {
        const all = this.library.allSongs;
        const snapshots = state?.playlists ?? [];
        const allSnapshot = snapshots.find((snapshot) => snapshot.id === ALL_SONGS_ID);

        // Library in its saved order, then any song missing from it.
        const placed = new Set<string>();
        for (const id of allSnapshot?.order ?? []) {
          const song = songs.get(id);
          if (song && !placed.has(id)) {
            all.add(song);
            placed.add(id);
          }
        }
        for (const [id, song] of songs) if (!placed.has(id)) all.add(song);

        for (const snapshot of snapshots) {
          if (snapshot.id === ALL_SONGS_ID) continue;
          const playlist = this.library.create(snapshot.name, snapshot.id);
          playlist.addMany(snapshot.order.map((id) => songs.get(id)).filter((song): song is Song => !!song));
        }
      });

      // Songs saved before "recently added" sorting existed have no addedAt: give them
      // increasing timestamps in library order (later in the library = more recent).
      const undated = [...this.library.allSongs.songs].filter((song) => !Number.isFinite(song.addedAt));
      if (undated.length > 0) {
        const base = Date.now() - undated.length;
        undated.forEach((song, i) => (song.addedAt = base + i));
        void Promise.all(undated.map((song) => this.store.putSong(song))).catch(() => undefined);
      }

      this.viewed = (state && this.library.get(state.viewedId)) || this.library.allSongs;
      // Spotify songs queued without being in the library come back with the queue.
      for (const song of state?.queue?.extraSongs ?? []) if (!songs.has(song.id)) songs.set(song.id, song);
      this.restoreQueue(state, songs);
      // Launch on the player only when there is a song to show on it.
      if (!this.queue.current) this.screen = 'library';

      if (this.library.allSongs.size > 0) {
        this.syncTrack(false, state?.position ?? 0);
        toast(strings.storage.restored(this.library.allSongs.size, this.library.userCount));
      }
    } catch {
      this.storageAvailable = false;
      toast(strings.storage.unavailable, 'error');
    }
  }

  /** The saved queue as it was; states from older versions rebuild it from the playlist that was playing. */
  private restoreQueue(state: PersistedState | null, songs: Map<string, Song>): void {
    const saved = state?.queue;
    const source = (saved?.sourceId && this.library.get(saved.sourceId)) || this.library.allSongs;
    if (saved?.order) {
      const queued = saved.order.map((id) => songs.get(id)).filter((song): song is Song => !!song);
      this.queue.restore(source, queued, saved.currentId, saved.shuffle, saved.continuous);
    } else if (saved) {
      this.queue.load(source, saved.currentId, saved.shuffle);
    } else if (source.size > 0) {
      this.queue.load(source, null, false);
    }
  }

  private schedulePersist(): void {
    if (this.restoring || !this.storageAvailable) return;
    window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => void this.persist(), 300);
  }

  private async persist(): Promise<void> {
    const playlists = [];
    for (const playlist of this.library.playlists) playlists.push(playlist.snapshot());
    const inLibrary = new Set(this.library.allSongs.order());
    const extraSongs = [...this.queue.songs].filter(
      (song): song is SpotifySong => song.source === 'spotify' && !inLibrary.has(song.id),
    );
    const state: PersistedState = {
      version: 6,
      playlists,
      viewedId: this.viewed.id,
      repeat: this.repeat,
      volume: this.volume,
      position: this.engine.currentTime || this.pendingStartAt,
      view: this.screen,
      queueExpanded: this.queueExpanded,
      queue: this.queue.size > 0 ? { ...this.queue.snapshot(), extraSongs } : null,
    };
    try {
      await this.store.saveState(state);
    } catch {
      /* ignore: everything keeps working in memory */
    }
  }

  private async updateStorageMeter(): Promise<void> {
    const meter = byId('storage-meter');
    const size = this.library.allSongs.size;
    if (!this.storageAvailable || size === 0) {
      meter.textContent = '';
      return;
    }
    let usage: string | null = null;
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.usage) usage = formatBytes(estimate.usage);
    } catch {
      /* estimate not supported */
    }
    meter.textContent = strings.storage.meterShort(size, usage);
    meter.title = strings.storage.meter(size, usage);
    meter.setAttribute('aria-label', meter.title);
  }

  // ---- Wiring ----

  /** Both engines report to the app; only the active one counts, and the other is kept silent. */
  private bindEngines(): void {
    for (const engine of [this.local, this.spotifyEngine] as PlaybackEngine[]) {
      const active = () => engine === this.engine;
      engine.on('timeupdate', () => {
        if (!active()) return;
        this.transport.renderProgress(this.engine.currentTime, this.engine.duration || this.queue.current?.duration || 0);
        this.renderCassettes();
        if (performance.now() - this.lastPositionSave > 5000) {
          this.lastPositionSave = performance.now();
          this.schedulePersist();
        }
      });
      engine.on('play', () => {
        if (!active()) engine.pause(); // never two players at once
        else this.onPlayStateChange();
      });
      engine.on('pause', () => {
        if (active()) this.onPlayStateChange();
      });
      engine.on('ended', () => {
        if (active()) this.onEnded();
      });
      engine.on('error', (message) => {
        if (!active()) return;
        toast(message ?? strings.transport.cannotPlay(this.queue.current?.title ?? null), 'error');
      });
    }
  }

  private applyVolume(): void {
    const level = this.muted ? 0 : this.volume;
    this.local.setVolume(level);
    this.spotifyEngine.setVolume(level);
    this.transport.renderVolume(this.volume, this.muted);
  }

  private onPlayStateChange(): void {
    this.transport.renderPlayState(!this.engine.paused);
    this.render();
  }

  /** Clicking the backdrop of a dialog closes it. */
  private bindDialogs(): void {
    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog')) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
  }

  private bindShortcutsAndMedia(): void {
    bindShortcuts({ toggle: () => this.togglePlay() });

    bindMediaSession({
      play: () => {
        if (this.engine.paused) this.togglePlay();
      },
      pause: () => {
        if (!this.engine.paused) this.togglePlay();
      },
      next: () => this.next(),
      previous: () => this.previous(),
      seekTo: (seconds) => this.engine.seek(seconds),
    });
  }
}
