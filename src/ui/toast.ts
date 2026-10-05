import { byId } from './dom';

type ToastKind = 'info' | 'success' | 'error';
let hideTimer = 0;

/** Single status message at the bottom of the screen. `sticky` keeps it until replaced. */
export function toast(message: string, kind: ToastKind = 'info', sticky = false): void {
  const element = byId('toast');
  element.textContent = message;
  element.dataset.kind = kind;
  element.hidden = false;
  window.clearTimeout(hideTimer);
  if (!sticky) hideTimer = window.setTimeout(() => (element.hidden = true), kind === 'error' ? 6000 : 3800);
}
