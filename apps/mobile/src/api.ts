import { PhotoChaseClient } from '@photochase/client';

/**
 * The API base URL. Injected at build time by Expo (`EXPO_PUBLIC_API_URL`);
 * falls back to localhost for the scaffold. `process` is read defensively so
 * this typechecks without @types/node in the mobile toolchain.
 */
const baseUrl =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_API_URL ??
  'http://localhost:3000';

/**
 * A single shared client. The auth token supplier is wired to the Cognito
 * session store in a later phase; for now the scaffold runs unauthenticated.
 */
export const client = new PhotoChaseClient({
  baseUrl,
  getToken: () => getAuthToken(),
});

let authToken: string | null = null;

/** Set by the auth flow once the user signs in (Phase 2). */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

function getAuthToken(): string | null {
  return authToken;
}
