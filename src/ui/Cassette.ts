import { create } from './dom';

/**
 * The cassette that plays the current song (SVG from the identity sheet).
 * The tape moves from the left spool to the right one as the song advances, and
 * the reels spin only while playing, for local and Spotify songs alike.
 */

export type CassetteSize = 'large' | 'compact' | 'mini';

/** Tape spool radii in the 400 × 252 box: the left one empties (24 → 12), the right one fills (12 → 24). */
export function spoolRadii(progress: number): { left: number; right: number } {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return { left: 24 - 12 * p, right: 12 + 12 * p };
}

/** Shortens `text` to `maxChars` characters, ending in "…" when cut. */
export function truncateLabel(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

/** Characters that fit on the label for each size (Righteous 20–22 px, Outfit 12 px). */
const LABEL_LIMITS: Record<CassetteSize, { title: number; subtitle: number }> = {
  large: { title: 26, subtitle: 44 },
  compact: { title: 22, subtitle: 0 },
  mini: { title: 0, subtitle: 0 },
};

const STRIPES = ['#0F3A5C', '#2E9AA5', '#F5C59A', '#F59A1E', '#DB3A1F', '#A3141E'];
const REEL = (cx: number) =>
  `<g class="cassette-reel"><circle cx="${cx}" cy="108" r="13" fill="none" stroke="#E3C79A" stroke-width="3"/><circle cx="${cx}" cy="108" r="5" fill="#E3C79A"/><path d="M${cx} 95V100M${cx} 116V121M${cx - 13} 108H${cx - 8}M${cx + 8} 108H${cx + 13}" stroke="#E3C79A" stroke-width="3" stroke-linecap="round"/></g>`;

function svgFor(size: CassetteSize): string {
  if (size === 'mini') {
    // Dock cassette: no label text, four thicker stripes and bolder reels.
    const miniReel = (cx: number) =>
      `<g class="cassette-reel"><circle cx="${cx}" cy="108" r="16" fill="none" stroke="#E3C79A" stroke-width="6"/><path d="M${cx} 92V100M${cx} 116V124M${cx - 16} 108H${cx - 8}M${cx + 8} 108H${cx + 16}" stroke="#E3C79A" stroke-width="5"/></g>`;
    return `<svg viewBox="0 0 400 252" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="396" height="248" rx="18" fill="#2B2930"/>
      <rect x="28" y="22" width="344" height="150" rx="10" fill="#F4E9D8"/>
      <rect x="28" y="84" width="344" height="12" fill="#2E9AA5"/>
      <rect x="28" y="96" width="344" height="12" fill="#F5C59A"/>
      <rect x="28" y="108" width="344" height="12" fill="#F59A1E"/>
      <rect x="28" y="120" width="344" height="12" fill="#DB3A1F"/>
      <rect x="112" y="80" width="176" height="56" rx="28" fill="#141317"/>
      ${miniReel(150)}${miniReel(250)}
      <path d="M112 250L128 204H272L288 250" fill="#232128"/>
    </svg>`;
  }
  const large = size === 'large';
  const stripes = STRIPES.map((color, i) => `<rect x="28" y="${84 + i * 8}" width="344" height="8" fill="${color}"/>`).join('');
  return `<svg viewBox="0 0 400 252" aria-hidden="true" focusable="false">
    <rect x="2" y="2" width="396" height="248" rx="16" fill="#2B2930" stroke="#3A3740" stroke-width="2"/>
    ${large ? '<circle cx="18" cy="18" r="5" fill="#4A4752"/><circle cx="382" cy="18" r="5" fill="#4A4752"/><circle cx="18" cy="234" r="5" fill="#4A4752"/><circle cx="382" cy="234" r="5" fill="#4A4752"/>' : ''}
    <rect x="28" y="22" width="344" height="150" rx="8" fill="#F4E9D8"/>
    <text class="cassette-title" x="46" y="${large ? 52 : 54}" font-family="Righteous, sans-serif" font-size="${large ? 20 : 22}" fill="#1C1A20"></text>
    ${large ? '<text class="cassette-subtitle" x="46" y="72" font-family="Outfit, sans-serif" font-size="12" fill="#5C5348"></text>' : ''}
    ${stripes}
    <rect x="112" y="80" width="176" height="56" rx="28" fill="#141317" stroke="#1C1A20" stroke-width="3"/>
    <circle class="cassette-spool cassette-spool--left" cx="150" cy="108" r="24" fill="#3B2B22"/>
    <circle class="cassette-spool cassette-spool--right" cx="250" cy="108" r="12" fill="#3B2B22"/>
    ${REEL(150)}${REEL(250)}
    <path d="M112 250L128 204H272L288 250" fill="#232128" stroke="#3A3740" stroke-width="2"/>
    ${large ? '<circle cx="152" cy="234" r="5" fill="#0A0A0C"/><circle cx="248" cy="234" r="5" fill="#0A0A0C"/><rect x="178" y="226" width="9" height="11" rx="2" fill="#0A0A0C"/><rect x="213" y="226" width="9" height="11" rx="2" fill="#0A0A0C"/>' : ''}
  </svg>`;
}

export interface CassetteState {
  title: string;
  /** "artist, playlist" on the large label. */
  subtitle: string;
  /** 0–1, how much of the song has played. */
  progress: number;
  playing: boolean;
  /** Accessible name of the whole player graphic ("playing <title>" in the UI language). */
  label: string;
}

/** A cassette in one of three sizes; decorative SVG inside a labelled element. */
export class Cassette {
  readonly element: HTMLElement;
  private readonly title: SVGTextElement | null;
  private readonly subtitle: SVGTextElement | null;
  private readonly left: SVGCircleElement | null;
  private readonly right: SVGCircleElement | null;
  private last = '';

  constructor(private readonly size: CassetteSize) {
    this.element = create('div', `cassette cassette--${size}`);
    this.element.setAttribute('role', 'img');
    this.element.innerHTML = svgFor(size);
    this.title = this.element.querySelector('.cassette-title');
    this.subtitle = this.element.querySelector('.cassette-subtitle');
    this.left = this.element.querySelector('.cassette-spool--left');
    this.right = this.element.querySelector('.cassette-spool--right');
  }

  update(state: CassetteState): void {
    const limits = LABEL_LIMITS[this.size];
    const { left, right } = spoolRadii(state.progress);
    // Called on every timeupdate: touch the DOM only when something visible changed.
    const key = `${state.title}|${state.subtitle}|${left.toFixed(1)}|${state.playing}|${state.label}`;
    if (key === this.last) return;
    this.last = key;
    if (this.title) this.title.textContent = truncateLabel(state.title, limits.title);
    if (this.subtitle) this.subtitle.textContent = truncateLabel(state.subtitle, limits.subtitle);
    this.left?.setAttribute('r', left.toFixed(2));
    this.right?.setAttribute('r', right.toFixed(2));
    this.element.classList.toggle('is-playing', state.playing);
    this.element.setAttribute('aria-label', state.label);
  }
}
