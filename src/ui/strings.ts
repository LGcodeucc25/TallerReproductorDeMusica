import type { RepeatMode, SortKey } from '../core/Playlist';

/**
 * Every user-visible text of the app (Spanish UI), in one place.
 * Texts with variables are functions. Static texts of index.html live in the HTML.
 */

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const songs = (count: number) => plural(count, 'canción', 'canciones');
const quoted = (name: string) => `«${name}»`;

const pad2 = (count: number) => String(count).padStart(2, '0');

export const strings = {
  appName: 'Liberty Music',

  library: {
    allSongs: 'Todas las canciones',
    newPlaylist: (n: number) => `Mi playlist ${n}`,
    unknownArtist: 'Artista desconocido',
    yourLibrary: 'tu biblioteca',
  },

  playing: 'Sonando',
  nothingPlaying: 'Nada sonando',
  getStarted: 'Importa canciones desde tu equipo para empezar.',
  play: 'Reproducir',
  pause: 'Pausar',
  playSong: (title: string) => `Reproducir ${title}`,
  playPlaylist: (name: string) => `Reproducir ${name}`,
  fullScreen: 'Pantalla completa',
  exitFullScreen: 'Salir de pantalla completa',
  mute: 'Silenciar',
  unmute: 'Quitar silencio',
  coverOf: (name: string) => `Portada de ${name}`,

  cassette: {
    playing: (title: string) => `Reproduciendo ${title}`,
    empty: 'Nada sonando',
    /** Second line of the label drawn on the player: "artist, playlist". */
    subtitle: (artist: string, playlist: string | null) => (playlist ? `${artist}, ${playlist}` : artist),
  },

  views: {
    lyricsOn: 'Ocultar lyrics',
    lyricsOff: 'Mostrar lyrics',
    fullScreen: 'Pantalla completa',
    exitFullScreen: 'Salir de pantalla completa',
  },

  repeatLabels: {
    off: 'Repetir: desactivado',
    all: 'Repetir: toda la playlist',
    one: 'Repetir: esta canción',
  } satisfies Record<RepeatMode, string>,
  repeatToasts: {
    off: 'Repetición desactivada.',
    all: 'Repetir toda la playlist: al terminar vuelve a empezar.',
    one: 'Repetir esta canción.',
  } satisfies Record<RepeatMode, string>,
  shuffleLabel: (on: boolean) => `Orden aleatorio: ${on ? 'activado' : 'desactivado'}`,
  shuffleOn: 'Orden aleatorio activado',
  shuffleOff: 'Orden aleatorio desactivado: la cola vuelve al orden de la playlist',

  transport: {
    importFirst: 'Importa canciones para empezar.',
    lastSong: 'Es la última canción de la lista. Activa «Repetir toda la playlist» para volver a empezar.',
    firstSong: 'Es la primera canción de la lista.',
    cannotPlay: (title: string | null) =>
      `No se pudo reproducir ${title ? quoted(title) : 'la canción'}. El formato puede no ser compatible con este navegador.`,
  },

  stage: {
    playingFrom: (name: string) => `Sonando desde ${name}`,
    openSource: (name: string) => `Abrir ${name} en la biblioteca`,
    nothing: '—',
    upnextHint: 'Clic para reproducir. Arrastra para cambiar el orden.',
    more: (count: number) => `y ${count} más`,
    endOfQueue: 'No hay más canciones después de esta.',
    emptyQueue: 'La cola está vacía.',
    repeatOne: 'Se repetirá esta canción.',
    expandQueue: 'Expandir cola',
    collapseQueue: 'Contraer cola',
    reshuffle: 'Volver a mezclar',
    reshuffled: 'Cola mezclada de nuevo.',
    /** Divider before the songs that continuous playback added to the queue. */
    continuous: 'Reproducción continua',
  },

  header: {
    meta: (isLibrary: boolean, count: number, duration: string) =>
      `${isLibrary ? 'Biblioteca' : 'Playlist'}. ${count === 0 ? 'Sin canciones.' : `${songs(count)}, ${duration}.`}`,
    /** Tape label above the title: "PLAYLIST  /  07 CANCIONES  /  36 MIN". */
    tapeMeta: (isLibrary: boolean, count: number, duration: string) =>
      [isLibrary ? 'BIBLIOTECA' : 'PLAYLIST', `${pad2(count)} ${count === 1 ? 'CANCIÓN' : 'CANCIONES'}`, ...(count ? [duration.toUpperCase()] : [])].join('  /  '),
    clearLibrary: 'Vaciar biblioteca',
    clearPlaylist: 'Quitar todas',
    searchLibrary: 'Buscar en tu biblioteca',
    searchPlaylist: 'Buscar en la playlist',
    emptyLibraryHtml:
      '<strong>Tu biblioteca está vacía.</strong> Arrastra archivos de audio aquí o usa «Importar canciones». Se guardan solo en este navegador.',
    emptyPlaylistHtml:
      '<strong>Esta playlist está vacía.</strong> Importa canciones nuevas, usa «Agregar de tu biblioteca» o arrastra canciones sobre su nombre en «Tus playlists».',
  },

  sidebar: {
    meta: (isLibrary: boolean, count: number, duration: string | null) =>
      `${isLibrary ? 'Biblioteca' : 'Playlist'}, ${songs(count)}${duration ? `, ${duration}` : ''}`,
  },

  row: {
    gripHint: 'Arrastra para mover, o suéltala sobre una playlist',
    play: (title: string, artist: string, position: number) => `Reproducir ${title} de ${artist}, posición ${position}`,
    options: (title: string) => `Más opciones para ${title}`,
    moveUp: (title: string) => `Subir ${title}`,
    moveDown: (title: string) => `Bajar ${title}`,
    deleteFromLibrary: (title: string) => `Eliminar ${title} de la biblioteca`,
    removeFromPlaylist: (title: string) => `Quitar ${title} de la playlist`,
  },

  addMenu: {
    playNext: 'Reproducir a continuación',
    saveToLibrary: 'Guardar en tu biblioteca',
    openInSpotify: 'Abrir en Spotify',
    addToPlaylist: 'Agregar a playlist',
    alreadyThere: 'ya está',
    nowPlaying: 'sonando',
    newPlaylistWith: 'Nueva playlist con esta canción',
  },

  picker: {
    title: (name: string) => `Agregar a ${name}`,
    emptyLibrary: 'Tu biblioteca está vacía. Importa canciones primero.',
    note: 'Se agregarán en el orden de tu biblioteca. Después puedes moverlas arrastrándolas.',
    alreadyThere: 'Ya está',
    confirm: (count: number) => (count === 0 ? 'Agregar' : `Agregar ${songs(count)}`),
  },

  playlists: {
    newNamePrompt: 'Nombre de la nueva playlist',
    created: (name: string) => `Playlist ${quoted(name)} creada. Importa canciones o agrégalas desde tu biblioteca.`,
    createdWith: (name: string, title: string) => `Se creó ${quoted(name)} con ${quoted(title)}.`,
    added: (title: string, name: string) => `${quoted(title)} se agregó al final de ${quoted(name)}.`,
    alreadyIn: (title: string, name: string) => `${quoted(title)} ya está en ${quoted(name)}.`,
    addedMany: (count: number, name: string) =>
      `${plural(count, 'canción agregada', 'canciones agregadas')} a ${quoted(name)}.`,
    nameRequired: 'Escribe un nombre para la playlist.',
    renamed: (name: string) => `Playlist renombrada a ${quoted(name)}.`,
    confirmDelete: (name: string) => `¿Eliminar la playlist ${quoted(name)}? Sus canciones seguirán en tu biblioteca.`,
    deleted: (name: string) => `Se eliminó la playlist ${quoted(name)}.`,
    reversed: (name: string) => `${quoted(name)} invertida.`,
    sorted: (key: SortKey) =>
      `${
        { title: 'Ordenada por título.', artist: 'Ordenada por artista.', recent: 'Ordenada: primero las agregadas recientemente.' }[key]
      } Puedes seguir moviendo canciones arrastrándolas.`,
    playNext: (title: string, after: string | null) =>
      after ? `${quoted(title)} sonará después de ${quoted(after)}.` : `${quoted(title)} sonará a continuación.`,
  },

  removal: {
    removedFromPlaylist: (title: string, name: string) => `Se quitó ${quoted(title)} de ${quoted(name)}. Sigue en tu biblioteca.`,
    confirmDeleteEverywhere: (title: string, names: string[]) =>
      `${quoted(title)} también está en ${names.map(quoted).join(', ')}. ¿Eliminarla de la biblioteca y de esas playlists?`,
    deletedFromLibrary: (title: string) => `Se eliminó ${quoted(title)} de tu biblioteca.`,
    confirmClearPlaylist: (name: string) => `¿Quitar todas las canciones de ${quoted(name)}? Seguirán en tu biblioteca.`,
    playlistCleared: (name: string) => `${quoted(name)} quedó vacía.`,
    confirmClearLibrary:
      '¿Vaciar la biblioteca? Se borrarán las canciones guardadas en este navegador y todas las playlists quedarán vacías.',
    libraryCleared: 'Biblioteca vaciada.',
  },

  importing: {
    dropHere: (name: string, hasSongs: boolean) =>
      hasSongs
        ? `Suelta para agregar al final de ${quoted(name)}, o llévalas sobre la lista para elegir el lugar.`
        : `Suelta para agregar a ${quoted(name)}.`,
    noAudio: 'Ninguno de esos archivos es de audio. Formatos admitidos: MP3, WAV, OGG, M4A, AAC, FLAC y OPUS.',
    reading: (index: number, total: number, fileName: string) => `Leyendo ${index} de ${total}: ${fileName}`,
    placeEnd: (target: string) => `al final de ${target}`,
    placeStart: (target: string) => `al inicio de ${target}`,
    placeDropped: (target: string, count: number) => `a ${target}, en el lugar donde ${count === 1 ? 'la' : 'las'} soltaste`,
    playlistTarget: (name: string) => quoted(name),
    added: (count: number, place: string, alsoLibrary: boolean) =>
      `${plural(count, 'canción agregada', 'canciones agregadas')} ${place}${alsoLibrary ? ', y a tu biblioteca' : ''}.`,
    skipped: (count: number) => `${count} ${count === 1 ? 'archivo no era' : 'archivos no eran'} de audio.`,
    unsaved: (count: number) =>
      `${count} no se ${count === 1 ? 'pudo' : 'pudieron'} guardar en el navegador (sin espacio); seguirán en la lista hasta recargar.`,
  },

  spotify: {
    /** Name of this browser tab in the user's list of Spotify Connect devices. */
    deviceName: 'Liberty Music (navegador)',
    chip: (name: string) => `Spotify: ${name}`,
    chipConnect: 'Conectar Spotify',
    notConfigured: 'Spotify no está configurado: falta VITE_SPOTIFY_CLIENT_ID en .env.local.',
    connectedAs: (name: string) => `Conectado como ${name}`,
    notPremium: 'Tu cuenta no es Premium: puedes buscar en Spotify, pero solo se puede escuchar con Premium.',
    loadingUser: 'Cargando tu cuenta…',
    redirecting: 'Abriendo Spotify…',
    connecting: 'Conectando el reproductor…',
    ready: 'Reproductor listo.',
    reconnecting: 'El reproductor de Spotify se desconectó. Esperando a que vuelva…',
    mark: 'Spotify',
    connectToPlay: 'Conecta Spotify para reproducir esta canción',
    skipped: 'Se saltaron canciones de Spotify: conecta Spotify (Premium) para escucharlas.',
    playerError: (reason: string, message: string) => `Error (${reason}): ${message}`,
    errorReasons: {
      'sdk-load': 'carga del SDK',
      initialization: 'inicialización',
      authentication: 'autenticación',
      account: 'cuenta, se necesita Premium',
      playback: 'reproducción',
      connect: 'conexión',
      timeout: "sin respuesta 'ready'",
      transfer: 'transferencia al navegador',
    },
    forbidden: (message: string) =>
      `Spotify rechazó la solicitud (403): tu usuario debe estar en User Management de la app y tener Premium. ${message}`,
    rateLimited: (seconds: number | null) => `Demasiadas solicitudes a Spotify. Intenta de nuevo en ${seconds ?? 1} s.`,
    sessionExpired: 'La sesión de Spotify expiró. Vuelve a conectar.',
    deviceMissing: (message: string) => `El reproductor del navegador no está disponible. ${message}`,
    loginDenied: 'Cancelaste el acceso a Spotify.',
    stateMismatch: 'La respuesta de Spotify no coincide con la solicitud. Vuelve a conectar.',
    loginFailed: (message: string) => `No se pudo completar el inicio de sesión: ${message}`,
    genericError: (message: string) => `Error de Spotify: ${message}`,
  },

  search: {
    resultsFor: (query: string) => `Resultados para ${quoted(query)}`,
    loading: 'Buscando…',
    noLocal: 'Nada en tu biblioteca coincide.',
    noSpotify: 'Spotify no encontró canciones.',
    nothing: (query: string) => `No encontramos resultados para ${quoted(query)}.`,
    sourceName: 'Resultados de búsqueda',
    error: (message: string) => `No se pudo buscar en Spotify. ${message}`,
    saved: (title: string) => `${quoted(title)} se guardó en tu biblioteca.`,
    alreadySaved: (title: string) => `${quoted(title)} ya está en tu biblioteca.`,
  },

  lyrics: {
    loading: 'Buscando la letra…',
    nothingPlaying: 'Reproduce una canción para ver su letra.',
    notSynced: 'Esta letra no está sincronizada',
    instrumental: 'Esta canción es instrumental',
    notFound: 'No encontramos la letra de esta canción',
    error: 'No se pudo cargar la letra. Revisa tu conexión a internet.',
    retry: 'Reintentar',
    syncedLabel: 'LYRICS',
    hint: 'Toca una línea para saltar a ese momento.',
    backToCurrent: 'Volver a la línea actual',
    interlude: '♪ ♪ ♪',
    attribution: 'Lyrics: LRCLIB',
    seekTo: (line: string) => `Ir a: ${line}`,
  },

  storage: {
    restored: (count: number, playlists: number) =>
      `Se recuperaron ${songs(count)}${playlists ? ` y ${plural(playlists, 'playlist', 'playlists')}` : ''} guardadas en este navegador.`,
    unavailable: 'Este navegador no permite guardar canciones. La biblioteca funcionará hasta que recargues la página.',
    meterShort: (count: number, usage: string | null) => (usage ? `${usage} guardados` : plural(count, 'canción', 'canciones')),
    meter: (count: number, usage: string | null) =>
      `${plural(count, 'canción guardada', 'canciones guardadas')} en este navegador${usage ? ` (${usage})` : ''}`,
  },
};
