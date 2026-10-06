/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Spotify only accepts loopback redirect URIs with an IP (http://127.0.0.1:5173/), not
// "localhost", so the dev and preview servers are pinned to that exact address.
const loopback = { host: '127.0.0.1', port: 5173, strictPort: true };

export default defineConfig({
  // Relative base: the build works under any path (Vercel, GitHub Pages).
  base: './',
  server: loopback,
  preview: loopback,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
