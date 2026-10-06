import { logoSvg } from './brand';
import { prefersReducedMotion } from './dom';
import { splashHideDelay, splashTiming } from './splashTiming';

/**
 * Launch screen: covers the app on every page load while the library is restored.
 * The sequence (stripe band, floor stripes, logo layers, disc, "music", rewind bar)
 * is pure CSS; this class only decides when it leaves.
 */
export class Splash {
  private readonly shownAt = performance.now();
  private readonly timing = splashTiming(prefersReducedMotion());

  constructor(private readonly element: HTMLElement) {
    const logo = element.querySelector<HTMLElement>('[data-splash-logo]');
    if (logo) logo.innerHTML = logoSvg({ width: 150, extrude: true, spinSeconds: 1.4 });
  }

  /** Hides the splash once `ready` settles (at least minMs, at most maxMs after it appeared). */
  async hideWhen(ready: Promise<unknown>): Promise<void> {
    let done = false;
    await new Promise<void>((resolve) => {
      const check = () => {
        const delay = splashHideDelay(performance.now() - this.shownAt, done, this.timing);
        if (delay === null) return;
        window.clearTimeout(maxTimer);
        window.setTimeout(resolve, delay);
      };
      const maxTimer = window.setTimeout(check, Math.max(0, this.timing.maxMs - (performance.now() - this.shownAt)));
      void ready.finally(() => {
        done = true;
        check();
      });
    });
    this.element.classList.add('is-leaving');
    await new Promise((resolve) => window.setTimeout(resolve, this.timing.fadeMs));
    this.element.hidden = true;
  }
}
