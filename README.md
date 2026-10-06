# Liberty Music

*Reproduce, organiza y repite tu música, guardada en tu equipo.*


Taller de **Estructuras de Datos**: un reproductor de música construido sobre
**listas doblemente enlazadas** escritas en TypeScript, con un frontend que
permite importar canciones desde el computador de cada usuario y organizarlas en
playlists.

Las canciones nunca se suben a ningún servidor: el navegador las lee del equipo,
las reproduce y las guarda en su propio almacenamiento (IndexedDB) para que la
lista siga ahí al volver a abrir la página.

## Identidad retro

Liberty Music tiene una identidad de los años 80: un casete, un ecualizador de
LEDs y una paleta de franjas (medianoche, océano, laguna, menta, durazno,
naranja, tomate y carmesí) sobre fondo negro. Los títulos usan Righteous con
una sombra de franjas, la interfaz usa Outfit y los contadores de tiempo usan
VT323. El logo apila la L, la B y la Y en vertical, con un disco de
vinilo que gira dentro de la B.

La app tiene dos vistas:

- **Reproduciendo**: el escenario con el casete grande (sus bobinas giran
  mientras suena y la cinta pasa de un carrete al otro según el avance), el
  ecualizador de LEDs, el contador con la barra de progreso y las teclas del
  deck. A un lado, la canción que suena (portada, título, artista, álbum y
  «Agregar a playlist»), «A continuación» (anterior y siguiente) y la cola, que
  se puede reordenar arrastrando y se desplaza dentro de su tarjeta. La cola se
  puede expandir hacia arriba: ocupa toda la columna y la canción actual queda
  en una fila compacta. Toda la vista cabe en la ventana sin desplazarse (los
  tamaños dependen de la altura de la pantalla), y en el móvil los controles
  quedan fijos abajo.
- **Biblioteca**: el estante «Tus playlists», la playlist abierta con
  su carátula (J-card), los resultados de la búsqueda y, abajo, el reproductor
  minimizado (dock).

La letra sincronizada abre su propia vista con un deck compacto, y «Pantalla
completa» agranda el escenario de Reproduciendo. Al abrir la página se muestra
una pantalla de carga («Cargando tu biblioteca») mientras se recupera la
biblioteca. Todas las animaciones respetan «reducir movimiento» del sistema.

## Tres listas doblemente enlazadas

Cada canción es un `Node<Song>` con `value`, `next` y `prev`, igual que el código
de la clase. El reproductor usa tres listas dobles, independientes entre sí:

1. **La biblioteca** (`PlaylistLibrary`) es una `DoublyLinkedList<Playlist>`:
   cada nodo es una playlist.
2. **Cada playlist** (`Playlist`) es una `DoublyLinkedList<Song>`: una colección
   ordenada que solo cambia cuando el usuario la edita (agregar, quitar, arrastrar,
   ordenar, invertir).
3. **La cola de reproducción** (`PlaybackQueue`) es otra `DoublyLinkedList<Song>`,
   con nodos propios que apuntan a los mismos objetos `Song`. Guarda una
   **referencia al nodo actual**, así que adelantar o retroceder es seguir un
   enlace, sin recorrer la lista. Mezclar o reordenar la cola nunca cambia la
   playlist, como en Spotify.

```
Biblioteca:  null ← [Todas las canciones] ⇄ [Rock] ⇄ [Para estudiar] → null
                          │                    │
Rock:                     │          null ← [A] ⇄ [C] → null
Todas:          null ← [A] ⇄ [B] ⇄ [C] → null

Cola (desde Rock, aleatoria):   null ← [C] ⇄ [A] → null     current = C
```

- «Todas las canciones» es siempre el `head` de la biblioteca y no se puede mover
  ni eliminar.
- Una canción puede estar en varias playlists y en la cola: cada lista tiene su
  propio nodo, pero todos apuntan al mismo objeto `Song`, así que el archivo se
  guarda una sola vez.
- Al hacer clic en una canción, la cola se arma desde esa playlist empezando en
  esa canción (`load`). Puedes abrir otra playlist mientras suena la cola.
- Si la playlist de origen cambia, la cola la sigue (`syncWith`): las canciones
  quitadas salen de la cola y las nuevas entran al final (o en un lugar al azar
  después de la actual si el orden aleatorio está activo). Si la playlist se
  reordena y el aleatorio está apagado, la cola toma el nuevo orden sin cortar la
  canción que suena.
- Eliminar una canción de «Todas las canciones» la quita de todas las playlists y
  de la cola. Si se elimina la playlist que suena, la cola sigue desde «Todas las
  canciones» con la misma canción.

| Requisito del taller | Gesto del usuario | Lista | Operación | Costo |
| --- | --- | --- | --- | --- |
| Agregar al inicio | Soltar archivos encima de la primera canción | Playlist | `prepend(value)` | O(1) |
| Agregar al final | «Importar canciones», «Importar carpeta», «Agregar de tu biblioteca», o soltar archivos debajo de la última canción o fuera de la lista | Playlist | `append(value)` usando `tail` | O(1) |
| Agregar en cualquier posición | Soltar archivos entre dos canciones (la línea magenta marca el hueco) | Playlist | `insert(index, value)` para la primera; las demás con `insertAfter` | O(n) |
| Eliminar una canción | Botón de papelera | Playlist y cola | `remove(index)` / `removeNode(node)` | O(n) / O(1) |
| Reordenar arrastrando | Arrastrar una fila de la lista principal | Playlist | `move(from, to)`: desenlaza y reenlaza el mismo nodo | O(n) |
| Ordenar | «Ordenar» → Título, Artista o Agregadas recientemente | Playlist | `sort(compare)`: merge sort estable que reenlaza los nodos | O(n log n) |
| Invertir la lista (sirve como Z–A) | Botón invertir | Playlist | `reverse()`: cada nodo intercambia `next` y `prev` | O(n) |
| Reproducir desde una canción | Clic en una canción o en el botón de reproducir de la playlist | Cola | `load`: copia el orden con `append` | O(n) |
| Adelantar canción | Botón siguiente, o al terminar una canción | Cola | `current = current.next` | O(1) |
| Retroceder canción | Botón anterior | Cola | `current = current.prev` | O(1) |
| Repetir toda la lista (activado por defecto) | Botón repetir | Cola | de `tail` se salta a `head` y viceversa; con aleatorio, cada vuelta se vuelve a mezclar | O(1) / O(n²) al mezclar |
| Reproducir a continuación | Botón «+» de una canción → «Reproducir a continuación» | Cola | `insertAfter(current, value)`; si ya estaba, `moveAfter` del mismo nodo | O(1) |
| Reordenar la cola | Arrastrar una canción en «A continuación» | Cola | `moveBefore(node, ref)` / `moveAfter(node, ref)`: por nodo, no por índice, así funciona aunque la cola pase de `tail` a `head` | O(1) |
| Activar orden aleatorio | Botón aleatorio de la barra inferior | Cola | `shuffle()`: Fisher–Yates reenlazando los nodos, y `moveToFront(current)` para que la canción que suena quede como `head` | O(n²) + O(1) |
| Desactivar orden aleatorio | El mismo botón | Cola | `sort(compare)` con la posición de cada canción en la playlist: vuelve su orden con los mismos nodos | O(n log n) |
| Volver a mezclar la cola | Botón «Volver a mezclar» de la tarjeta «Cola» | Cola | `shuffleAfter(current)`: Fisher–Yates reenlazando solo los nodos que vienen después de la actual; la actual y las anteriores no se mueven | O(k²) para las k siguientes |
| Reproducción continua | Llegar a la última canción con «Repetir» desactivado | Cola | `extendForContinuousPlay`: agrega al final con `append` (usando `tail`) las canciones de la biblioteca que no están en la cola, mezcladas; si ya están todas, una vuelta nueva y mezclada de la playlist de origen (`removeNode` + `append`) | O(1) por canción agregada (O(n) para elegirlas) |

Ordenar, invertir, mezclar, volver a mezclar, mover y «Reproducir a continuación»
nunca crean nodos nuevos: solo cambian enlaces. Por eso la referencia al nodo
actual sigue siendo válida y la canción que suena no se corta.

### Volver a mezclar y reproducción continua

- **Volver a mezclar** (botón junto a «Expandir cola») da un orden nuevo y al azar
  a todas las canciones que vienen después de la actual, con orden aleatorio
  activado o no, y sin cambiar ese botón. La canción que suena sigue sin cortes y
  «Anterior» no cambia. Se desactiva si quedan menos de dos canciones después.
- **Reproducción continua**: con «Repetir» desactivado la música no se detiene al
  final de la cola. En cuanto empieza la última canción se agregan al final las
  canciones de «Todas las canciones» que no estaban en la cola (mezcladas); si ya
  estaban todas, se agrega una vuelta nueva y mezclada de la playlist de origen
  (como cada canción está una sola vez en la cola, las que ya sonaron pasan a esa
  vuelta). Se saltan las que no se pueden reproducir (por ejemplo, de Spotify sin
  conexión). En la cola aparecen después del separador «Reproducción continua» y
  son canciones normales: se pueden arrastrar y reproducir como las demás.
  «Siguiente» muestra siempre la canción real que viene; solo muestra «—» si no
  queda nada que se pueda reproducir.
- «Repetir esta canción» la sigue repitiendo y «Repetir toda la playlist» vuelve
  al inicio (con una vuelta mezclada de nuevo si el orden aleatorio está activo).
- El fin de una canción llega igual desde los dos motores: el `<audio>` local y
  Spotify (que no tiene evento de fin: se detecta por su estado, con un temporizador
  de respaldo para las pestañas en segundo plano).

`traverseToIndex` recorre desde `head` o desde `tail`, lo que esté más cerca:
una ventaja que solo tiene la lista doble. `printList()` sigue disponible en
`DoublyLinkedList` como en el código de la clase.

## Funcionalidades

- Crear, renombrar, reordenar y eliminar playlists.
- Agregar canciones a una playlist de tres formas: importándolas con la playlist
  abierta, con «Agregar de tu biblioteca», o con el botón «+» de cada canción
  (también se pueden arrastrar sobre el nombre de la playlist).
- «Reproducir a continuación» desde el botón «+» de cada canción, como en Spotify.
- «Volver a mezclar» las canciones que vienen en la cola, sin cortar la que suena.
- Reproducción continua: con «Repetir» desactivado, al terminar la cola siguen
  sonando canciones de tu biblioteca.
- Ordenar por título, por artista o por las agregadas recientemente.
- Cola de reproducción independiente de las playlists: lo que se hace en
  «A continuación» (arrastrar, «Reproducir a continuación», orden aleatorio)
  nunca cambia la playlist.
- Orden aleatorio en la barra inferior, a la izquierda de «anterior»: mezcla la
  cola sin cortar la canción actual y, al desactivarlo, la cola vuelve al orden de
  la playlist.
- «Repetir toda la playlist» viene activado: al terminar la última canción sigue
  la primera, y con el orden aleatorio cada vuelta tiene un orden nuevo. El botón
  cambia entre toda la playlist, una canción y desactivado.
- «A continuación» muestra hasta 30 canciones; se pueden arrastrar para cambiar
  el orden de la cola o soltar sobre una playlist del estante.
- Dos vistas, Reproduciendo y Biblioteca (con el reproductor minimizado), y
  pantalla completa. Se muestra la canción anterior y la siguiente (la que de
  verdad va a sonar) y la cola («A continuación»). La app recuerda la vista
  abierta.
- Importar archivos o carpetas completas (se agregan al final), o arrastrarlos:
  sobre la lista entran justo en el hueco marcado; en el resto de la página, al
  final.
- Lectura de título, artista, álbum y portada desde las etiquetas ID3 del MP3
  (lector propio, sin librerías). Si el archivo no tiene etiquetas, se usa el
  nombre del archivo con el formato `Artista - Título`.
- Eliminar, subir, bajar y arrastrar canciones para reordenar.
- Adelantar, retroceder (si la canción lleva más de 3 s, vuelve al inicio de la
  canción), repetir lista o canción, orden aleatorio e invertir.
- Canciones de Spotify dentro de las mismas listas (ver «Spotify» más abajo).
- Barra de búsqueda principal: busca en tu biblioteca y en Spotify a la vez.
- Letra sincronizada estilo karaoke para canciones locales y de Spotify (ver
  «Letras» más abajo).
- Ecualizador de LEDs: con canciones locales muestra el análisis en tiempo real
  del audio (Web Audio API, escala logarítmica de 40 Hz a 16 kHz); con canciones
  de Spotify, cuyo audio no se puede analizar, muestra una animación decorativa
  generada para cada canción.
- Filtro «Buscar en la playlist» dentro de la playlist abierta.
- La barra espaciadora reproduce o pausa. Las teclas multimedia del teclado y los
  controles del sistema también funcionan.
- La biblioteca, las playlists, la cola (con su orden, la canción actual y el
  orden aleatorio), la posición, el volumen, el tamaño de la vista de
  reproducción y la repetición se guardan en el navegador.

## Estructura

```
src/
  core/                  Estructura de datos, sin DOM
    Node.ts              Nodo: value, next, prev
    DoublyLinkedList.ts  Lista doble genérica
    Playlist.ts          Playlist: lista doble ordenada de canciones
    PlaylistLibrary.ts   Biblioteca: lista doble de playlists
    PlaybackQueue.ts     Cola de reproducción: lista doble independiente + nodo actual
    Song.ts              Canción local o de Spotify (unión discriminada por `source`)
    lyrics.ts            Lector de LRC y búsqueda binaria de la línea activa
    id.ts                Generador de identificadores
  services/              Navegador: audio, red y almacenamiento
    PlaybackEngine.ts    Interfaz común de los reproductores
    LocalAudioEngine.ts  <audio> + analizador para el ecualizador (archivos locales)
    SongStore.ts         IndexedDB (canciones, estado y caché de letras)
    metadata.ts          Duración y datos de cada archivo
    id3.ts               Lector de etiquetas ID3v2
    spotify/             auth.ts (PKCE), api.ts (Web API), player.ts (Web Playback SDK),
                         session.ts (conexión), SpotifyEngine.ts, trackEnd.ts, mapping.ts
    lyrics/              lrclib.ts (cliente de LRCLIB) y LyricsService.ts (caché)
  ui/                    Interfaz: solo refleja el estado de las listas
    App.ts               Conecta todo y elige el reproductor según la canción
    SidebarView.ts       Estante «Tus playlists» (lista de playlists)
    NowPlayingView.ts    Vista Reproduciendo: origen, portada, «A continuación» y la cola
    Transport.ts         Teclas del deck, contadores, progreso y volumen (escenario, dock y letra)
    Cassette.ts          Casete SVG (grande, compacto y mini) con bobinas y cinta
    Equalizer.ts         Ecualizador de LEDs en canvas (y equalizerMath.ts, sus cálculos puros)
    brand.ts             Logo de Liberty Music
    Splash.ts            Pantalla de carga (y splashTiming.ts, sus tiempos)
    HeaderView.ts        Cabecera y acciones de la playlist abierta
    QueueView.ts         Canciones de la playlist abierta
    songRow.ts           Fila de canción compartida (playlist y búsqueda)
    SearchView.ts        Resultados de la búsqueda principal
    LyricsView.ts        Letra sincronizada, estilo karaoke
    AddMenu.ts           Menú «+» de una canción
    menu.ts              Posición y navegación con teclado de los menús flotantes
    LibraryPicker.ts     Diálogo para elegir canciones de la biblioteca
    SpotifyPanel.ts      Conexión con Spotify (estante y chip de la barra superior)
    strings.ts           Todos los textos visibles de la interfaz (en español)
  styles.css
tests/                   Pruebas unitarias (Vitest)
```

La capa `core` no conoce el DOM: la interfaz se suscribe a la `Playlist` y se
vuelve a dibujar cuando la lista cambia.

## Ejecutar en local

Requiere Node.js 20.19 o superior.

```bash
npm install
npm run dev      # http://127.0.0.1:5173 (Spotify no acepta "localhost")
npm test         # pruebas de la lista doble, las playlists, la biblioteca y el lector ID3
npm run build    # genera dist/
```

## Spotify

Con una cuenta **Premium**, las canciones de Spotify son canciones más del
reproductor: se buscan en la barra principal, se guardan en «Todas las
canciones», se agregan a playlists y pasan por la misma cola de reproducción
(repetir, aleatorio, «Reproducir a continuación», arrastrar en «A continuación»).

- Cada canción de Spotify se guarda solo como datos (título, artista, portada,
  enlace), con el id `spotify:<id de Spotify>`, así que nunca se duplica. El
  audio lo transmite Spotify a esta pestaña con el Web Playback SDK.
- La app elige el reproductor según la canción: `LocalAudioEngine` para archivos
  y `SpotifyEngine` para Spotify. Al cambiar de uno a otro, el anterior se pausa.
- Spotify reproduce solo la canción que pide la app; si intenta seguir con otra
  por su cuenta (autoplay), se pausa y nuestra cola decide qué sigue.
- Las canciones de Spotify muestran su portada, una marca de Spotify y, en el
  menú «+», el enlace «Abrir en Spotify» (las pautas de Spotify piden atribución
  y un enlace de vuelta).
- Sin conexión (o sin Premium) siguen en las playlists, pero se ven
  deshabilitadas y la cola las salta.

### Búsqueda principal

Escribir al menos 2 letras en «¿Qué quieres reproducir?» muestra dos secciones:
«En tu biblioteca» y «Spotify» (hasta 10 resultados). Al hacer clic en un
resultado, la cola se arma con los resultados visibles de esa sección
(«Resultados de búsqueda»), sin crear una playlist. Esc, borrar el texto o abrir
una playlist vuelve a la vista anterior.

### Requisitos

- Cuenta **Spotify Premium** (sin Premium se puede buscar, pero no reproducir).
- Una app en el [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
  con las APIs **Web API** y **Web Playback SDK**, y estas **Redirect URIs**
  exactamente (con la barra final):
  - `http://127.0.0.1:5173/` (desarrollo; Spotify no acepta `localhost`)
  - `https://taller-reproductor-de-musica-tau.vercel.app/` (producción)
- En Development Mode, cada persona que vaya a probarla debe estar en
  **User Management** de la app (nombre y correo de su cuenta de Spotify).
- La variable `VITE_SPOTIFY_CLIENT_ID` con el Client ID de la app:
  - en local, en `.env.local` (no se sube al repositorio; `.env.example` muestra
    el formato);
  - en Vercel, en **Settings → Environment Variables**, y luego volver a desplegar.

No se usa el client secret: el inicio de sesión es Authorization Code con PKCE
desde el navegador, sin backend. Los tokens se guardan en `localStorage` de ese
navegador y se renuevan solos antes de vencer. Antes de reproducir, la app
transfiere la reproducción a esta pestaña (`PUT /me/player`).

### Limitaciones (Development Mode)

- Máximo 5 usuarios en la lista de User Management.
- La búsqueda devuelve como máximo 10 resultados.
- Hace falta Premium para escuchar.
- El audio de Spotify está protegido con DRM y no se puede analizar: con
  canciones de Spotify el ecualizador muestra una simulación decorativa (distinta
  para cada canción), no el sonido real.

### Diagnóstico

Cada paso de Spotify se registra en la consola del navegador con el prefijo
`[spotify]` (nivel «Verbose»/«Detallado»): carga del SDK, `ready` con el id del
dispositivo, resultado de la transferencia, código de cada solicitud de
reproducción y cada `player_state_changed`.

## Letras

La vista «Lyrics» (botón del micrófono en Reproduciendo, en el reproductor
minimizado o en pantalla completa) muestra la letra de la canción que suena, estilo karaoke: la línea
actual resaltada, las anteriores atenuadas, desplazamiento automático (se
detiene si desplazas a mano, hasta «Volver a la línea actual») y clic en una
línea para saltar a ese momento.

- Fuente: [LRCLIB](https://lrclib.net), una base de datos pública de letras, sin
  clave. El navegador la consulta directamente (permite CORS), así que **hace
  falta internet**.
- Funciona con canciones locales (usa el título, artista, álbum y duración de las
  etiquetas ID3) y con canciones de Spotify.
- Si solo hay letra sin tiempos, se muestra fija con la nota «Esta letra no está
  sincronizada»; también avisa si la canción es instrumental o si no hay letra.
- Las letras (y los «no encontrada», durante una semana) se guardan en
  IndexedDB para no preguntar de nuevo en cada reproducción.

## Desplegar en GitHub Pages

1. Sube el proyecto a un repositorio en GitHub (rama `main`).
2. En el repositorio: **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.
3. Cada `push` a `main` ejecuta las pruebas, compila y publica el sitio
   (`.github/workflows/deploy.yml`). La URL aparece en la pestaña **Actions** y
   en **Settings → Pages**.

La configuración usa `base: './'`, así que funciona con cualquier nombre de
repositorio.

## Notas

- Los formatos que se pueden reproducir dependen del navegador. MP3, WAV, OGG,
  M4A y FLAC funcionan en Chrome, Edge y Firefox.
- Las canciones guardadas pertenecen a ese navegador y ese equipo. Otra persona,
  u otro navegador, empieza con su propia lista vacía.
- «Importar carpeta» es para escritorio. En pantallas pequeñas las vistas se
  apilan y el estante «Tus playlists» se desplaza en horizontal.
- Si ya habías usado la primera versión, tu lista se migra automáticamente a
  «Todas las canciones».
- La base de datos del navegador se renombró a `doubly-linked-music-player`. La
  primera vez que abres esta versión, las canciones y el estado guardados en la
  base anterior se copian a la nueva y la anterior se elimina: no se pierde nada.
