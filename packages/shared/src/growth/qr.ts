/**
 * Join-code links, for QR display and scanning.
 *
 * The lobby shows a QR the host holds up; a joiner scans it instead of typing
 * six characters across a room. The QR encodes a URL rather than the bare code
 * so it can later degrade to a web landing page for anyone without the app —
 * deep-link handling does not exist yet, so today the in-app scanner just pulls
 * the code back out of whatever it read.
 *
 * The matrix itself is generated in the app (the `qrcode` package renders it);
 * what lives here is the pure, bit-exact-testable pair either side of it: what
 * string goes in, and how a scanned string becomes a code again.
 */

/** Where a scanned link would resolve on the web. Not yet a live page — see the module note. */
export const JOIN_LINK_ORIGIN = 'https://photochase.app';
/** The app's custom URL scheme (app.json `scheme`), for deep links into it. */
export const JOIN_LINK_SCHEME = 'photochase';

/** The web link a lobby QR encodes for a given join code. */
export function joinCodeUrl(code: string): string {
  return `${JOIN_LINK_ORIGIN}/j/${code}`;
}

/** The deep link that opens the app straight onto a join code. */
export function joinDeepLink(code: string): string {
  return `${JOIN_LINK_SCHEME}://j/${code}`;
}

/** Join codes are six characters from an unambiguous alphabet (see ids.ts). */
const CODE = /^[A-Za-z0-9]{6}$/;
/** The two forms we recognise: the web link and the app deep link. */
const LINK_PREFIXES = [`${JOIN_LINK_ORIGIN}/j/`, `${JOIN_LINK_SCHEME}://j/`];

/**
 * Pull a join code out of a payload — our web `/j/<code>` link, our
 * `photochase://j/<code>` deep link, or a bare code someone shared as text — or
 * null if it is none of those. The string is untrusted (scanned QR, or an
 * inbound URL), so only our own origin and scheme are accepted, not any URL that
 * happens to end in `/j/<code>`. Tolerant of case and a trailing slash; the code
 * is normalised to upper case, the form the server issues them in.
 */
export function parseJoinCode(payload: string): string | null {
  const trimmed = payload.trim();
  for (const prefix of LINK_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length).replace(/\/$/, '');
      return CODE.test(rest) ? rest.toUpperCase() : null;
    }
  }
  if (CODE.test(trimmed)) return trimmed.toUpperCase();
  return null;
}
