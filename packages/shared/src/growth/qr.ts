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

/** Where a scanned link would resolve. Not yet a live page — see the module note. */
export const JOIN_LINK_ORIGIN = 'https://photochase.app';

/** The link a lobby QR encodes for a given join code. */
export function joinCodeUrl(code: string): string {
  return `${JOIN_LINK_ORIGIN}/j/${code}`;
}

/** Join codes are six characters from an unambiguous alphabet (see ids.ts). */
const CODE = /^[A-Za-z0-9]{6}$/;
const LINK_PREFIX = `${JOIN_LINK_ORIGIN}/j/`;

/**
 * Pull a join code out of a scanned payload — our own `/j/<code>` link, or a
 * bare code someone shared as text — or null if it is neither. The scanned
 * string is untrusted, so only our exact origin is accepted, not any URL that
 * happens to end in `/j/<code>`. Tolerant of case and a trailing slash; the code
 * is normalised to upper case, the form the server issues them in.
 */
export function parseJoinCode(payload: string): string | null {
  const trimmed = payload.trim();
  if (trimmed.startsWith(LINK_PREFIX)) {
    const rest = trimmed.slice(LINK_PREFIX.length).replace(/\/$/, '');
    return CODE.test(rest) ? rest.toUpperCase() : null;
  }
  if (CODE.test(trimmed)) return trimmed.toUpperCase();
  return null;
}
