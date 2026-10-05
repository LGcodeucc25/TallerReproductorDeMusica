/**
 * Minimal ID3v2 (2.2, 2.3, 2.4) reader: title, artist, album and cover art.
 * No external dependencies; works on the bytes of the start of an MP3 file.
 */
export interface TagInfo {
  title?: string;
  artist?: string;
  album?: string;
  picture?: { mime: string; data: Uint8Array };
}

export function readSyncsafe(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = start; i < start + length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** Undoes ID3 "unsynchronisation" (0xFF 0x00 → 0xFF). */
function removeUnsync(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let j = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[j++] = bytes[i];
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

function decode(bytes: Uint8Array, encoding: number): string {
  try {
    switch (encoding) {
      case 1: {
        // UTF-16 with BOM
        if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
        if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
        return new TextDecoder('utf-16le').decode(bytes);
      }
      case 2:
        return new TextDecoder('utf-16be').decode(bytes);
      case 3:
        return new TextDecoder('utf-8').decode(bytes);
      default:
        return new TextDecoder('latin1').decode(bytes);
    }
  } catch {
    return '';
  }
}

function readText(frame: Uint8Array): string {
  if (frame.length < 2) return '';
  // ID3v2.4 may hold several values separated by nulls: keep the first one.
  return decode(frame.subarray(1), frame[0]).split('\u0000')[0].trim();
}

/** Index right after a null terminator (1 byte, or 2 aligned bytes for UTF-16). */
function skipTerminated(bytes: Uint8Array, start: number, encoding: number): number {
  const wide = encoding === 1 || encoding === 2;
  if (wide) {
    for (let i = start; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) return i + 2;
    }
  } else {
    for (let i = start; i < bytes.length; i++) if (bytes[i] === 0) return i + 1;
  }
  return bytes.length;
}

function normalizeMime(mime: string): string {
  const value = mime.trim().toLowerCase();
  if (value === 'jpg' || value === 'jpeg' || value === 'image/jpg') return 'image/jpeg';
  if (value === 'png') return 'image/png';
  return value.startsWith('image/') ? value : 'image/jpeg';
}

function readApic(frame: Uint8Array): TagInfo['picture'] {
  const encoding = frame[0];
  const mimeEnd = skipTerminated(frame, 1, 0);
  const mime = ascii(frame, 1, mimeEnd - 2);
  const dataStart = skipTerminated(frame, mimeEnd + 1, encoding); // skip picture type + description
  const data = frame.subarray(dataStart);
  return data.length > 0 ? { mime: normalizeMime(mime), data } : undefined;
}

function readPic(frame: Uint8Array): TagInfo['picture'] {
  const encoding = frame[0];
  const format = ascii(frame, 1, 3);
  const dataStart = skipTerminated(frame, 5, encoding); // 1 enc + 3 format + 1 type
  const data = frame.subarray(dataStart);
  return data.length > 0 ? { mime: normalizeMime(format), data } : undefined;
}

export function hasId3Header(bytes: Uint8Array): boolean {
  return bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
}

export function parseId3v2(bytes: Uint8Array): TagInfo | null {
  if (!hasId3Header(bytes)) return null;
  const major = bytes[3];
  if (major < 2 || major > 4) return null;

  const flags = bytes[5];
  const tagSize = readSyncsafe(bytes, 6);
  let data = bytes.subarray(10, Math.min(bytes.length, 10 + tagSize));
  if (flags & 0x80 && major < 4) data = removeUnsync(data);

  let pos = 0;
  if (flags & 0x40 && major >= 3) {
    pos = major === 3 ? 4 + readUint32(data, 0) : readSyncsafe(data, 0);
  }

  const idLength = major === 2 ? 3 : 4;
  const headerLength = major === 2 ? 6 : 10;
  const info: TagInfo = {};

  while (pos + headerLength <= data.length) {
    const id = ascii(data, pos, idLength);
    if (!/^[A-Z0-9]+$/.test(id)) break; // reached padding

    let size: number;
    if (major === 2) size = (data[pos + 3] << 16) | (data[pos + 4] << 8) | data[pos + 5];
    else if (major === 4) size = readSyncsafe(data, pos + 4);
    else size = readUint32(data, pos + 4);

    const start = pos + headerLength;
    const end = start + size;
    if (size <= 0 || end > data.length) break;

    let frame = data.subarray(start, end);
    if (major === 4) {
      const formatFlags = data[pos + 9];
      if (formatFlags & 0x0c) {
        pos = end; // compressed or encrypted: skip
        continue;
      }
      if (formatFlags & 0x01) frame = frame.subarray(4); // data length indicator
      if (formatFlags & 0x02) frame = removeUnsync(frame);
    }

    switch (id) {
      case 'TIT2':
      case 'TT2':
        info.title ||= readText(frame);
        break;
      case 'TPE1':
      case 'TP1':
        info.artist ||= readText(frame);
        break;
      case 'TALB':
      case 'TAL':
        info.album ||= readText(frame);
        break;
      case 'APIC':
        info.picture ??= readApic(frame);
        break;
      case 'PIC':
        info.picture ??= readPic(frame);
        break;
    }
    pos = end;
  }

  return info;
}
