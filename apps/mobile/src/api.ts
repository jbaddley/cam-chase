import { PhotoChaseClient, type FetchFn } from '@photochase/client';
import { session } from './auth.js';
import { API_URL } from './config.js';
import { fixtureFetch } from './dev/fixtures.js';
import { fixturesEnabled } from './dev/fixture-toggle.js';

// Empty when unconfigured; `App` shows the configuration error instead of any
// screen that could issue a request. A localhost fallback used to live here,
// which turned a missing variable into a connection failure on every call.
const baseUrl = API_URL ?? '';

/**
 * Transport chosen per request, not once at construction. The harness is a
 * runtime toggle now (see `dev/fixture-toggle.ts`), so a client built once at
 * import time still has to be able to switch between the fake API and the real
 * one. Off — the default, and the only possibility outside a development bundle
 * because {@link fixturesEnabled} says so — this is the platform `fetch`.
 */
const fixtures = fixtureFetch();
const routedFetch: FetchFn = (input, init) =>
  fixturesEnabled() ? fixtures(input, init) : globalThis.fetch(input, init);

/**
 * A single shared client. Every request asks the auth session for a token, and
 * the session refreshes it when needed, so a long game never fails mid-round on
 * an expired token. Signed out, it returns null and the request goes without an
 * Authorization header.
 */
export const client = new PhotoChaseClient({
  baseUrl,
  getToken: () => session.getAccessToken(),
  fetch: routedFetch,
});
