import { PlaybackQueue } from '../core/PlaybackQueue';
import type { Playlist, RepeatMode, SortKey } from '../core/Playlist';
import { ALL_SONGS_ID, PlaylistLibrary } from '../core/PlaylistLibrary';
import type { Song } from '../core/Song';
import { AudioEngine } from '../services/AudioEngine';
import { isAudioFile, readSong } from '../services/metadata';
import { SongStore, type DockMode, type PersistedState } from '../services/SongStore';
import { AddMenu } from './AddMenu';
import { CoverCache } from './CoverCache';
import { byId, formatBytes } from './dom';
import { filesFromDrop, hasFiles } from './fileDrop';
import { HeaderView } from './HeaderView';
import { hydrateIcons } from './icons';
import { LibraryPicker } from './LibraryPicker';
import { bindMediaSession, updateMediaSession } from './mediaSession';
import { PlayerBar } from './PlayerBar';
import { QueueView } from './QueueView';
import { bindShortcuts } from './shortcuts';
import { SidebarView } from './SidebarView';
import { STAGE_DEFAULT, StageView, type PlayerMode } from './StageView';
import { strings } from './strings';
import { toast } from './toast';
import { Visualizer } from './Visualizer';

/** Repeat button cycle. */
const REPEAT_CYCLE: RepeatMode[] = ['all', 'one', 'off'];

/**
 * Connects the pieces. Three doubly linked lists hold the state:
 * the PlaylistLibrary (a list of playlists), each Playlist (a list of songs) and
 * the PlaybackQueue (an independent list of what plays next).
 * Views only draw them, the AudioEngine plays the queue and the SongStore saves everything.
 */
export class App {
  private readonly library = new PlaylistLibrary({
    allSongs: strings.library.allSongs,
    newPlaylist: strings.library.newPlaylist,
  });
  private readonly queue = new PlaybackQueue();
  private readonly engine = new AudioEngine();
  private readonly store = new SongStore();
  private readonly covers = new CoverCache();
  private readonly compact = window.matchMedia('(max-width: 900px)');

  private player!: PlayerBar;
  private stage!: StageView;
  private sidebar!: SidebarView;
  private header!: HeaderView;
  private songList!: QueueView;
  private addMenu!: AddMenu;
  private picker!: LibraryPicker;

  /** Playlist open in the main view (independent from what is playing, like Spotify). */
  private viewed: Playlist = this.library.allSongs;
  /** "Repeat the playlist" is on by default. */
  private repeat: RepeatMode = 'all';
  private mode: PlayerMode = 'panel';
  private dock: DockMode = 'panel';

  private loadedId: string | null = null;
  private wantsPlay = false;
  private restoring = true;
  /** True while the queue follows a library change, so the change is drawn once. */
  private syncingQueue = false;
  private persistTimer = 0;
  private lastPositionSave = 0;
  private storageAvailable = true;
  /** Nesting of dragenter/dragleave while files are dragged over the page. */
  private fileDragDepth = 0;

  async start(): Promise<void> {
    hydrateIcons();
    this.createViews();
    new Visualizer(byId<HTMLCanvasElement>('visualizer'), this.engine);

    this.bindEngine();
    this.bindImport();
    this.bindDialogs();
    this.bindShortcutsAndMedia();
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.mode === 'full') this.setMode(this.dock);
    });

    this.library.subscribe(() => this.onLibraryChange());
    this.queue.subscribe(() => this.onQueueChange());

    this.engine.volume = 0.8;
    this.stage.setWidth(STAGE_DEFAULT);
    await this.restore();
    this.setMode(this.dock);
    this.restoring = false;
    this.render();
    this.player.renderVolume();
    void this.updateStorageMeter();
  }

  private createViews(): void {
    this.player = new PlayerBar(this.engine, {
      onToggle: () => this.togglePlay(),
      onNext: () => this.next(),
      onPrevious: () => this.previous(),
      onRepeat: () => this.cycleRepeat(),
      onShuffle: () => this.toggleShuffle(),
      onCover: () => (this.compact.matches ? this.toggleFull() : this.togglePanel()),
      onPanel: () => this.togglePanel(),
      onFull: () => this.toggleFull(),
      onVolumeChange: () => this.schedulePersist(),
    });
    this.stage = new StageView({
      onModeRequest: (mode) => this.setMode(mode === 'docked' ? this.dock : mode),
      onResize: () => this.schedulePersist(),
      onPickUpcoming: (songId) => {
        this.wantsPlay = true;
        this.queue.selectById(songId);
        if (this.engine.paused) void this.engine.play();
      },
      onMoveUpcoming: (songId, refSongId, where) => this.queue.moveSong(songId, refSongId, where),
    });
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
      onAddTo: (songId, anchor) => this.addMenu.open(anchor, songId, this.library, this.loadedId),
      onDropFiles: (files, slot) => {
        this.endFileDrag();
        void this.importFiles(files, slot);
      },
    });
    this.addMenu = new AddMenu({
      onPlayNext: (songId) => this.playNext(songId),
      onAdd: (playlistId, songId) => this.addSongTo(playlistId, songId),
      onCreateWith: (songId) => this.createPlaylistWith(songId),
    });
    this.picker = new LibraryPicker();
  }

  /** The playlist the queue was loaded from, if it still exists. */
  private source(): Playlist | null {
    return this.queue.sourceId ? this.library.get(this.queue.sourceId) : null;
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
    this.render();
    this.syncTrack(this.wantsPlay);
    this.schedulePersist();
  }

  private render(): void {
    const song = this.queue.current;
    const coverUrl = this.covers.get(song);
    const playing = !this.engine.paused;
    const isLibrary = this.viewed === this.library.allSongs;
    const sourceId = this.queue.sourceId;

    this.player.renderTrack(song, coverUrl);
    this.player.renderControls({
      hasSong: !!song,
      hasNext: this.queue.hasNext(this.repeat),
      repeat: this.repeat,
      shuffle: this.queue.shuffle,
    });
    this.stage.render(this.queue, this.source()?.name ?? null, this.repeat, this.covers);
    this.sidebar.render(this.library, this.viewed.id, sourceId ?? '', playing, this.covers);
    this.header.render(this.viewed, this.viewed.id === sourceId, playing, this.covers);
    this.songList.render(this.viewed, this.covers, this.loadedId, playing, isLibrary);
    updateMediaSession(song, coverUrl, playing);
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
      this.player.renderProgress(0, 0);
      return;
    }
    this.engine.load(song.file, startAt);
    this.player.renderProgress(startAt, song.duration);
    if (autoplay) void this.engine.play();
  }

  // ---- Transport ----

  private togglePlay(): void {
    if (!this.queue.current) {
      if (this.viewed.size > 0) this.playViewed();
      else toast(strings.transport.importFirst);
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
    this.wantsPlay = true;
    this.queue.load(this.viewed, null, this.queue.shuffle);
    if (this.engine.paused) void this.engine.play();
  }

  /** Clicking a song of the open playlist loads the queue from that playlist, starting at it. */
  private playFromViewed(index: number): void {
    const song = this.viewed.songs.traverseToIndex(index)?.value;
    if (!song) return;
    this.wantsPlay = true;
    this.queue.load(this.viewed, song.id, this.queue.shuffle);
    if (this.engine.paused) void this.engine.play();
  }

  private next(): void {
    if (!this.queue.current) return;
    const previousId = this.loadedId;
    const song = this.queue.next(this.repeat);
    if (!song) toast(strings.transport.lastSong);
    else if (song.id === previousId) this.engine.seek(0);
  }

  /** Restarts the song if it is past 3 s, otherwise goes to the previous one. */
  private previous(): void {
    if (!this.queue.current) return;
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

  private onEnded(): void {
    const finishedId = this.loadedId;
    const song = this.queue.next(this.repeat, true);
    if (!song) {
      this.wantsPlay = false;
      this.engine.seek(0);
      this.render();
      return;
    }
    if (song.id === finishedId) {
      this.engine.seek(0);
      void this.engine.play();
    }
  }

  private cycleRepeat(): void {
    this.repeat = REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(this.repeat) + 1) % REPEAT_CYCLE.length];
    toast(strings.repeatToasts[this.repeat]);
    this.render();
    this.schedulePersist();
  }

  /** Shuffle changes the queue only; the playlists keep their order. */
  private toggleShuffle(): void {
    const on = !this.queue.shuffle;
    this.queue.setShuffle(on, this.source());
    toast(on ? strings.shuffleOn : strings.shuffleOff);
  }

  // ---- Player view: mini bar, resizable panel, full screen ----

  private setMode(mode: PlayerMode): void {
    const previous = this.mode;
    this.mode = mode;
    if (mode !== 'full') this.dock = mode;
    document.body.dataset.playerMode = mode;
    this.player.renderMode(mode);
    this.stage.renderMode(mode);

    if (mode === 'full' && previous !== 'full') {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else if (mode !== 'full' && document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    }
    this.schedulePersist();
  }

  private togglePanel(): void {
    if (this.compact.matches) return this.toggleFull();
    if (this.mode === 'full') return this.setMode('panel');
    this.setMode(this.mode === 'panel' ? 'mini' : 'panel');
  }

  private toggleFull(): void {
    this.setMode(this.mode === 'full' ? this.dock : 'full');
  }

  // ---- Playlists ----

  private openPlaylist(id: string): void {
    const playlist = this.library.get(id);
    if (!playlist || playlist === this.viewed) return;
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

  private createPlaylistWith(songId: string): void {
    const song = this.findSong(songId);
    const name = window.prompt(strings.playlists.newNamePrompt, this.library.defaultName());
    if (name === null || !song) return;
    const playlist = this.library.create(name);
    this.library.addToPlaylist(playlist.id, [song]);
    toast(strings.playlists.createdWith(playlist.name, song.title), 'success');
  }

  private addSongTo(playlistId: string, songId: string): void {
    const song = this.findSong(songId);
    const playlist = this.library.get(playlistId);
    if (!song || !playlist || playlist.id === ALL_SONGS_ID) return;
    const { added } = this.library.addToPlaylist(playlistId, [song]);
    toast(
      added ? strings.playlists.added(song.title, playlist.name) : strings.playlists.alreadyIn(song.title, playlist.name),
      added ? 'success' : 'info',
    );
  }

  /** "Play next": the song goes right after the current one in the queue; playlists are not touched. */
  private playNext(songId: string): void {
    const song = this.findSong(songId);
    if (!song) return;
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

  private findSong(songId: string): Song | null {
    return this.library.allSongs.songs.findNode((song) => song.id === songId)?.value ?? null;
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
        this.engine.volume = state.volume;
        this.dock = state.dock ?? 'panel';
        this.stage.setWidth(state.stageWidth ?? STAGE_DEFAULT);
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
      this.restoreQueue(state, songs);

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
      this.queue.restore(source, queued, saved.currentId, saved.shuffle);
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
    const state: PersistedState = {
      version: 4,
      playlists,
      viewedId: this.viewed.id,
      repeat: this.repeat,
      volume: this.engine.volume,
      position: this.engine.currentTime,
      dock: this.dock,
      stageWidth: this.stage.currentWidth,
      queue: this.queue.size > 0 ? this.queue.snapshot() : null,
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
    meter.textContent = strings.storage.meter(size, usage);
  }

  // ---- Wiring ----

  private bindEngine(): void {
    const el = this.engine.element;
    el.addEventListener('timeupdate', () => {
      this.player.renderProgress(this.engine.currentTime, this.engine.duration || this.queue.current?.duration || 0);
      if (performance.now() - this.lastPositionSave > 5000) {
        this.lastPositionSave = performance.now();
        this.schedulePersist();
      }
    });
    el.addEventListener('loadedmetadata', () => this.player.renderProgress(this.engine.currentTime, this.engine.duration));
    el.addEventListener('play', () => this.onPlayStateChange());
    el.addEventListener('pause', () => this.onPlayStateChange());
    el.addEventListener('ended', () => this.onEnded());
    el.addEventListener('error', () => {
      if (!this.engine.hasSource) return;
      toast(strings.transport.cannotPlay(this.queue.current?.title ?? null), 'error');
    });
  }

  private onPlayStateChange(): void {
    this.player.renderPlayState(!this.engine.paused);
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
