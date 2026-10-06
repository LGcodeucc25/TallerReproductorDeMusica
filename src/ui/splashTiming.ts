/** When the launch screen hides. Pure functions, unit-tested. */

export interface SplashTiming {
  /** Shown at least this long, so the sequence can be seen. */
  minMs: number;
  /** Hidden at the latest after this, even if the library is still loading. */
  maxMs: number;
  /** Length of the fade out. */
  fadeMs: number;
}

export function splashTiming(reducedMotion: boolean): SplashTiming {
  // Without motion there is no sequence to wait for, and no fade.
  return reducedMotion ? { minMs: 600, maxMs: 4000, fadeMs: 0 } : { minMs: 1600, maxMs: 4000, fadeMs: 300 };
}

/**
 * Milliseconds to wait before starting the fade out, given how long the splash
 * has been visible and whether the library finished restoring. Null means "keep
 * waiting for the library" (the maximum has not been reached yet).
 */
export function splashHideDelay(elapsedMs: number, ready: boolean, timing: SplashTiming): number | null {
  if (elapsedMs >= timing.maxMs) return 0;
  if (!ready) return null;
  return Math.max(0, timing.minMs - elapsedMs);
}
