import { describe, expect, it } from 'vitest';
import { parseId3v2 } from '../src/services/id3';
import { parseFileName } from '../src/services/metadata';

function frame(id: string, content: number[]): number[] {
  const size = content.length;
  return [...id].map((c) => c.charCodeAt(0)).concat([(size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, 0, 0], content);
}

const latin1 = (text: string) => [...text].map((c) => c.charCodeAt(0));
const utf16le = (text: string) => [0xff, 0xfe, ...[...text].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])];
const utf8 = (text: string) => [...new TextEncoder().encode(text)];

function tagV23(frames: number[][]): Uint8Array {
  const body = frames.flat();
  const size = body.length;
  const header = [0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127];
  return new Uint8Array([...header, ...body, 0, 0, 0, 0]);
}

describe('ID3v2 reader', () => {
  it('reads title, artist, album and cover', () => {
    const bytes = tagV23([
      frame('TIT2', [0, ...latin1('Hola')]),
      frame('TPE1', [1, ...utf16le('Ñandú')]),
      frame('TALB', [3, ...utf8('Álbum')]),
      frame('APIC', [0, ...latin1('image/png'), 0, 3, 0, 9, 8, 7]),
    ]);
    const info = parseId3v2(bytes);
    expect(info?.title).toBe('Hola');
    expect(info?.artist).toBe('Ñandú');
    expect(info?.album).toBe('Álbum');
    expect(info?.picture?.mime).toBe('image/png');
    expect([...(info?.picture?.data ?? [])]).toEqual([9, 8, 7]);
  });

  it('returns null without an ID3 header', () => {
    expect(parseId3v2(new Uint8Array(20))).toBeNull();
  });
});

describe('file name fallback', () => {
  it('splits "Artist - Title" and drops track numbers', () => {
    expect(parseFileName('03 - Soda Stereo - De música ligera.mp3')).toEqual({
      artist: 'Soda Stereo',
      title: 'De música ligera',
    });
    expect(parseFileName('mi_cancion.wav')).toEqual({ artist: '', title: 'mi cancion' });
  });
});
