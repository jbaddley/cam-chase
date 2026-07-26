import { PhotoChaseClient } from '@photochase/client';
import { session } from './auth.js';

/**
 * The API base URL. Injected at build time by Expo (`EXPO_PUBLIC_API_URL`);
 * falls back to localhost for the scaffold. `process` is read defensively so
 * this typechecks without @types/node in the mobile toolchain.
 */
const baseUrl =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_API_URL ??
  'http://localhost:3000';

/**
 * A single shared client. Every request asks the auth session for a token, and
 * the session refreshes it when needed, so a long game never fails mid-round on
 * an expired token. Signed out, it returns null and the request goes without an
 * Authorization header.
 */
export const client = new PhotoChaseClient({
  baseUrl,
  getToken: () => session.getAccessToken(),
});
