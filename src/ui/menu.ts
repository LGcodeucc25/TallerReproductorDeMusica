/** Helpers shared by the floating menus (.menu): placement and arrow-key focus. */

/** Places a fixed menu under its anchor, or above it when there is no room below. */
export function positionMenu(menu: HTMLElement, anchor: HTMLElement, align: 'start' | 'end' = 'end'): void {
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let top = rect.bottom + 6;
  if (top + menuRect.height > window.innerHeight - 12) top = Math.max(12, rect.top - menuRect.height - 6);
  const preferred = align === 'end' ? rect.right - menuRect.width : rect.left;
  const left = Math.min(Math.max(12, preferred), window.innerWidth - menuRect.width - 12);
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

/** ArrowDown / ArrowUp (wrapping), Home and End move the focus between enabled items. */
export function moveMenuFocus(menu: HTMLElement, event: KeyboardEvent): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else if (event.key === 'ArrowDown') next = (index + 1) % items.length;
  else next = index <= 0 ? items.length - 1 : index - 1;
  items[next].focus();
}
