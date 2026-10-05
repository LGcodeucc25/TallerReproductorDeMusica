# Enlace: reproductor de música con listas dobles

Taller de **Estructuras de Datos**: un reproductor de música construido sobre
**listas doblemente enlazadas** escritas en TypeScript, con un frontend que
permite importar canciones desde el computador de cada usuario y organizarlas en
playlists.

Las canciones nunca se suben a ningún servidor: el navegador las lee del equipo,
las reproduce y las guarda en su propio almacenamiento (IndexedDB) para que la
lista siga ahí al volver a abrir la página.

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

Ordenar, invertir, mezclar, mover y «Reproducir a continuación» nunca crean nodos
nuevos: solo cambian enlaces. Por eso la referencia al nodo actual sigue siendo
válida y la canción que suena no se corta.

`traverseToIndex` recorre desde `head` o desde `tail`, lo que esté más cerca:
una ventaja que solo tiene la lista doble. `printList()` sigue disponible en
`DoublyLinkedList` como en el código de la clase.

## Funcionalidades

- Crear, renombrar, reordenar y eliminar playlists.
- Agregar canciones a una playlist de tres formas: importándolas con la playlist
  abierta, con «Agregar de tu biblioteca», o con el botón «+» de cada canción
  (también se pueden arrastrar sobre el nombre de la playlist).
- «Reproducir a continuación» desde el botón «+» de cada canción, como en Spotify.
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
  el orden de la cola o soltar sobre una playlist de la barra lateral.
- Vista de reproducción como en Spotify: una barra fija abajo, un panel lateral
  que se agranda o achica arrastrando su borde (se cierra si lo achicas del todo)
  y un modo de pantalla completa. Muestra la canción anterior y la siguiente (la
  que de verdad va a sonar) y la cola («A continuación»).
- Importar archivos o carpetas completas (se agregan al final), o arrastrarlos:
  sobre la lista entran justo en el hueco marcado; en el resto de la página, al
  final.
- Lectura de título, artista, álbum y portada desde las etiquetas ID3 del MP3
  (lector propio, sin librerías). Si el archivo no tiene etiquetas, se usa el
  nombre del archivo con el formato `Artista - Título`.
- Eliminar, subir, bajar y arrastrar canciones para reordenar.
- Adelantar, retroceder (si la canción lleva más de 3 s, vuelve al inicio de la
  canción), repetir lista o canción, orden aleatorio e invertir.
- Visualizador de audio en tiempo real (Web Audio API).
- Búsqueda dentro de la lista.
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
    Song.ts              Tipo de dato de una canción
    id.ts                Generador de identificadores
  services/              Navegador: audio, archivos y almacenamiento
    AudioEngine.ts       <audio> + analizador para el visualizador
    SongStore.ts         IndexedDB
    metadata.ts          Duración y datos de cada archivo
    id3.ts               Lector de etiquetas ID3v2
  ui/                    Interfaz: solo refleja el estado de las listas
    App.ts               Conecta todo
    SidebarView.ts       Tu biblioteca (lista de playlists)
    HeaderView.ts        Cabecera y acciones de la playlist abierta
    QueueView.ts         Canciones de la playlist abierta
    PlayerBar.ts         Barra de reproducción inferior
    StageView.ts         Vista de reproducción: panel redimensionable o pantalla completa
    AddMenu.ts           Menú de una canción: «Reproducir a continuación» y «Agregar a playlist»
    menu.ts              Posición y navegación con teclado de los menús flotantes
    LibraryPicker.ts     Diálogo para elegir canciones de la biblioteca
    Visualizer.ts        Barras de frecuencia
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
npm run dev      # http://localhost:5173
npm test         # pruebas de la lista doble, las playlists, la biblioteca y el lector ID3
npm run build    # genera dist/
```

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
- «Importar carpeta» y el panel lateral redimensionable son para escritorio. En
  pantallas pequeñas la vista de reproducción se abre en pantalla completa.
- Si ya habías usado la primera versión, tu lista se migra automáticamente a
  «Todas las canciones».
- La base de datos del navegador se renombró a `doubly-linked-music-player`. La
  primera vez que abres esta versión, las canciones y el estado guardados en la
  base anterior se copian a la nueva y la anterior se elimina: no se pierde nada.
