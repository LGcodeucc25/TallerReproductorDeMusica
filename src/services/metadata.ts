import type { LocalSong } from '../core/Song';
import { createId } from '../core/id';
import { hasId3Header, parseId3v2, readSyncsafe, type TagInfo } from './id3';

const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba|webm)$/i;
const MAX_TAG_BYTES = 12 * 1024 * 1024;

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.test(file.name);
}

/**
 * Builds a Song from a local file: ID3 tags, duration and file-name fallback.
 * `unknownArtist` is the display text used when no artist can be found.
 */
export async function readSong(file: File, unknownArtist: string): Promise<LocalSong> {
  const [tags, duration] = await Promise.all([readTags(file), readDuration(file)]);
  const fromName = parseFileName(file.name);

  return {
    source: 'local',
    id: createId(),
    title: tags?.title || fromName.title,
    artist: tags?.artist || fromName.artist || unknownArtist,
    album: tags?.album || '',
    duration,
    fileName: file.name,
    file,
    cover: tags?.picture ? new Blob([tags.picture.data.slice()], { type: tags.picture.mime }) : null,
    addedAt: Date.now(),
  };
}

async function readTags(file: File): Promise<TagInfo | null> {
  try {
    const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (!hasId3Header(header)) return null;
    const size = readSyncsafe(header, 6);
    const bytes = new Uint8Array(await file.slice(0, Math.min(10 + size, MAX_TAG_BYTES)).arrayBuffer());
    return parseId3v2(bytes);
  } catch {
    return null;
  }
}

function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    let settled = false;

    const finish = (seconds: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(seconds) ? seconds : 0);
    };

    const timer = window.setTimeout(() => finish(0), 8000);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => finish(audio.duration), { once: true });
    audio.addEventListener('error', () => finish(0), { once: true });
    audio.src = url;
  });
}

/** "03 - Artist - Title.mp3" → { artist: "Artist", title: "Title" } */
export function parseFileName(fileName: string): { title: string; artist: string } {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .replace(/^\s*\d{1,3}\s*[-.)]\s*/, '')
    .trim();
  const separator = base.indexOf(' - ');
  if (separator > 0) {
    return { artist: base.slice(0, separator).trim(), title: base.slice(separator + 3).trim() || base };
  }
  return { artist: '', title: base || fileName };
}
