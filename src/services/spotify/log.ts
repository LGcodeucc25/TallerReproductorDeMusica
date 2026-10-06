/**
 * Debug trace of every Spotify step (SDK, device, transfer, play requests, state
 * changes), so playback problems can be diagnosed from the browser console.
 * Shown with the console's "Verbose" level; filter by "[spotify]".
 */
export function spotifyLog(...details: unknown[]): void {
  console.debug('[spotify]', ...details);
}
