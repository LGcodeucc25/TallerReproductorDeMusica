/**
 * Auto-scroll speed while dragging inside a scrolling list, in pixels per frame:
 * negative near the top edge, positive near the bottom one, 0 elsewhere. It grows
 * linearly from 0 at `edge` pixels from the border to `max` at the border and beyond.
 */
export function edgeScrollSpeed(pointerY: number, top: number, bottom: number, edge = 48, max = 14): number {
  if (bottom - top <= 0 || edge <= 0) return 0;
  const zone = Math.min(edge, (bottom - top) / 2);
  const fromTop = pointerY - top;
  const fromBottom = bottom - pointerY;
  if (fromTop < zone) return -Math.round(max * Math.min(1, (zone - fromTop) / zone));
  if (fromBottom < zone) return Math.round(max * Math.min(1, (zone - fromBottom) / zone));
  return 0;
}
