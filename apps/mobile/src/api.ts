import { PhotoChaseClient } from '@photochase/client';
import { session } from './auth.js';
import { API_URL } from './config.js';

// Empty when unconfigured; `App` shows the configuration error instead of any
// screen that could issue a request. A localhost fallback used to live here,
// which turned a missing variable into a connection failure on every call.
const baseUrl = API_URL ?? '';

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
