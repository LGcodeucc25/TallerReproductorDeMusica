/**
 * Liberty Music brand: the vertical L / B / Y monoline logo with its stripe
 * layers and the vinyl disc spinning inside the upper bowl of the B.
 * Values come from the approved identity sheet.
 */

/** The L, B and Y strokes, in a 122 × 380 box. */
export const LOGO_PATH =
  'M22 8V102H86M22 138V232M22 138H56A24 23 0 0 1 56 184H22M22 184H60A24 24 0 0 1 60 232H22M16 268L50 314M84 268L50 314V362';

/** Stripe layers behind the cream strokes, from the deepest one, with their offset in px. */
export const LOGO_LAYERS: readonly { color: string; offset: number }[] = [
  { color: '#0F3A5C', offset: 15 },
  { color: '#2E9AA5', offset: 12 },
  { color: '#F5C59A', offset: 9 },
  { color: '#F59A1E', offset: 6 },
  { color: '#DB3A1F', offset: 3 },
];

export interface LogoOptions {
  /** Rendered width in px (the height keeps the 122 × 380 ratio). */
  width: number;
  /** Accessible name; without it the logo is decorative (aria-hidden). */
  label?: string;
  /** Splash sequence: the stripe layers extrude one by one. */
  extrude?: boolean;
  /** Seconds per turn of the disc. */
  spinSeconds?: number;
}

/** The disc inside the upper bowl of the B (also used by the favicon). */
export const LOGO_DISC = `<g class="logo-disc">
  <circle cx="51" cy="161" r="14" fill="#141317" stroke="none"/>
  <circle cx="51" cy="161" r="11" stroke="#3A3740" stroke-width="1"/>
  <circle cx="51" cy="161" r="8" stroke="#3A3740" stroke-width="1"/>
  <circle cx="51" cy="161" r="5" fill="#DB3A1F" stroke="none"/>
  <path d="M47 158.5a5 5 0 0 1 3-2" stroke="#F5C59A" stroke-width="1.2"/>
  <circle cx="51" cy="161" r="1.3" fill="#0A0A0C" stroke="none"/>
</g>`;

/** SVG markup of the full logo. */
export function logoSvg(options: LogoOptions): string {
  const height = Math.round((options.width * 380) / 122);
  const a11y = options.label ? `role="img" aria-label="${escapeAttribute(options.label)}"` : 'aria-hidden="true" focusable="false"';
  const layers = LOGO_LAYERS.map(({ color, offset }, index) => {
    if (!options.extrude) return `<path d="${LOGO_PATH}" stroke="${color}" transform="translate(${offset} ${offset})"/>`;
    // Each layer slides out from under the strokes; the deepest one moves last.
    const delay = (0.7 + (LOGO_LAYERS.length - 1 - index) * 0.05).toFixed(2);
    return `<path class="logo-layer" d="${LOGO_PATH}" stroke="${color}" style="--d: ${offset}px; animation-delay: ${delay}s"/>`;
  }).join('');
  const spin = options.spinSeconds ?? 3;
  return `<svg class="logo" viewBox="0 0 122 380" width="${options.width}" height="${height}" fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" ${a11y} style="--spin: ${spin}s">${layers}<path d="${LOGO_PATH}" stroke="#F4E9D8"/>${LOGO_DISC}</svg>`;
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
