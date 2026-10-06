/**
 * Synced lyrics in LRC format: parsing, finding the active line, and marking
 * instrumental gaps. Pure functions, no DOM.
 */

export interface LyricLine {
  /** When the line starts, in milliseconds from the start of the song. */
  timeMs: number;
  text: string;
}

/** A displayable line: sung text, or an instrumental gap shown as an animated marker. */
export interface DisplayLine extends LyricLine {
  interlude: boolean;
}

/** Instrumental gaps longer than this are shown as an interlude line. */
export const INTERLUDE_MIN_MS = 5000;

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET_TAG = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i;

/**
 * Parses LRC text into lines sorted by time. Supports [mm:ss], [mm:ss.xx],
 * [mm:ss.xxx], several timestamps on one line and the [offset:±ms] tag
 * (a positive offset shows the lines earlier). Metadata tags and invalid lines are ignored.
 */
export function parseLrc(text: string): LyricLine[] {
  let offsetMs = 0;
  const lines: LyricLine[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const offset = OFFSET_TAG.exec(raw);
    if (offset) {
      offsetMs = Number(offset[1]);
      continue;
    }
    const times: number[] = [];
    let lyricStart = 0;
    TIME_TAG.lastIndex = 0;
    // Timestamps must be consecutive at the start of the line: "[00:01.00][00:20.00]text".
    for (let match = TIME_TAG.exec(raw); match && match.index === lyricStart; match = TIME_TAG.exec(raw)) {
      const [, minutes, seconds, fraction = '0'] = match;
      if (Number(seconds) >= 60) break;
      // ".5" is 500 ms, ".50" is 500 ms, ".500" is 500 ms.
      const fractionMs = Number(fraction.padEnd(3, '0'));
      times.push(Number(minutes) * 60_000 + Number(seconds) * 1000 + fractionMs);
      lyricStart = TIME_TAG.lastIndex;
    }
    if (times.length === 0) continue;
    const lyric = raw.slice(lyricStart).trim();
    for (const time of times) lines.push({ timeMs: time, text: lyric });
  }

  // Offsets apply to every line, wherever the tag appears.
  const shifted = lines.map((line) => ({ timeMs: Math.max(0, line.timeMs - offsetMs), text: line.text }));
  // Array.prototype.sort is stable, so lines with the same time keep their file order.
  return shifted.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Index of the line being sung at `timeMs` (the last line that started at or
 * before it), or -1 before the first line. Binary search: O(log n).
 */
export function activeLineIndex(lines: readonly { timeMs: number }[], timeMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].timeMs <= timeMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * Lines ready to display: empty lines that start a gap longer than
 * INTERLUDE_MIN_MS become interlude markers, other empty lines are dropped, and a
 * long instrumental intro gets a marker at 0.
 */
export function toDisplayLines(lines: readonly LyricLine[], minGapMs = INTERLUDE_MIN_MS): DisplayLine[] {
  const result: DisplayLine[] = [];
  const firstSung = lines.find((line) => line.text);
  if (firstSung && firstSung.timeMs > minGapMs) result.push({ timeMs: 0, text: '', interlude: true });

  lines.forEach((line, index) => {
    if (line.text) {
      result.push({ ...line, interlude: false });
      return;
    }
    const next = lines.slice(index + 1).find((later) => later.text);
    const gap = next ? next.timeMs - line.timeMs : Number.POSITIVE_INFINITY;
    const previous = result[result.length - 1];
    if (gap > minGapMs && next && !previous?.interlude) result.push({ ...line, interlude: true });
  });
  return result;
}
