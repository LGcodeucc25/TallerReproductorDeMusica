/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Spotify app client id (public; PKCE flow, no client secret). Set in .env.local and in Vercel. */
  readonly VITE_SPOTIFY_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
