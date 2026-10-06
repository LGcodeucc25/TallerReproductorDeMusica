import { describe, expect, it } from 'vitest';
import { activeLineIndex, parseLrc, toDisplayLines } from '../src/core/lyrics';

// Made-up lines only: no real song lyrics in the tests.
describe('parseLrc', () => {
  it('reads [mm:ss], [mm:ss.xx] and [mm:ss.xxx] timestamps', () => {
    const lines = parseLrc(['[00:05]first line', '[00:10.50]second line', '[01:02.345]third line'].join('\n'));
    expect(lines).toEqual([
      { timeMs: 5000, text: 'first line' },
      { timeMs: 10500, text: 'second line' },
      { timeMs: 62345, text: 'third line' },
    ]);
  });

  it('expands several timestamps on one line and sorts unsorted input', () => {
    const lines = parseLrc(['[00:30.00]later', '[00:20.00][00:40.00]repeated chorus', '[00:10.00]early'].join('\n'));
    expect(lines.map((line) => [line.timeMs, line.text])).toEqual([
      [10000, 'early'],
      [20000, 'repeated chorus'],
      [30000, 'later'],
      [40000, 'repeated chorus'],
    ]);
  });

  it('applies the [offset] tag: a positive offset shows lines earlier, never before 0', () => {
    const lines = parseLrc(['[ar:Someone]', '[offset:+500]', '[00:00.20]start', '[00:10.00]ten seconds'].join('\n'));
    expect(lines).toEqual([
      { timeMs: 0, text: 'start' },
      { timeMs: 9500, text: 'ten seconds' },
    ]);
    expect(parseLrc('[offset:-250]\n[00:01.00]one')[0].timeMs).toBe(1250);
  });

  it('ignores metadata, empty, invalid and malformed lines', () => {
    const text = ['[ti:Title]', '', 'no timestamp here', '[xx:yy]broken', '[00:75.00]bad seconds', '[00:03.00]valid', '  '].join('\r\n');
    expect(parseLrc(text)).toEqual([{ timeMs: 3000, text: 'valid' }]);
    expect(parseLrc('')).toEqual([]);
  });

  it('keeps empty timed lines (instrumental markers) and the order of equal times', () => {
    const lines = parseLrc('[00:01.00]a\n[00:01.00]b\n[00:02.00]');
    expect(lines.map((line) => line.text)).toEqual(['a', 'b', '']);
  });
});

describe('activeLineIndex', () => {
  const lines = parseLrc('[00:01.00]one\n[00:05.00]two\n[00:09.00]three\n[00:12.00]four');

  it('finds the last line that started (binary search)', () => {
    expect(activeLineIndex(lines, 0)).toBe(-1);
    expect(activeLineIndex(lines, 1000)).toBe(0);
    expect(activeLineIndex(lines, 4999)).toBe(0);
    expect(activeLineIndex(lines, 5000)).toBe(1);
    expect(activeLineIndex(lines, 11_000)).toBe(2);
    expect(activeLineIndex(lines, 600_000)).toBe(3);
  });

  it('handles empty lists and a single line', () => {
    expect(activeLineIndex([], 5000)).toBe(-1);
    expect(activeLineIndex([{ timeMs: 2000 }], 1000)).toBe(-1);
    expect(activeLineIndex([{ timeMs: 2000 }], 2000)).toBe(0);
  });
});

describe('toDisplayLines', () => {
  it('marks a long instrumental intro and long empty gaps as interludes', () => {
    const lines = toDisplayLines(parseLrc('[00:08.00]first\n[00:10.00]\n[00:20.00]after a break\n[00:21.00]\n[00:22.00]short gap'));
    expect(lines.map((line) => (line.interlude ? '♪' : line.text))).toEqual(['♪', 'first', '♪', 'after a break', 'short gap']);
    expect(lines[0].timeMs).toBe(0);
    expect(lines[2].timeMs).toBe(10000);
  });

  it('adds nothing when the song starts singing right away', () => {
    const lines = toDisplayLines(parseLrc('[00:01.00]right away\n[00:03.00]next'));
    expect(lines.every((line) => !line.interlude)).toBe(true);
  });
});
