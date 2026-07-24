declare module 'dynalite' {
  import type { Server } from 'node:http';
  /** dynalite returns an http.Server-compatible instance (listen/close/address). */
  export default function dynalite(options?: { createTableMs?: number; path?: string }): Server;
}
