/**
 * The three values that point the app at a backend.
 *
 * `EXPO_PUBLIC_*` variables are inlined **when the bundle is built**, not when
 * the app runs. An EAS build gets them from the profile's `env` block in
 * `eas.json`; a development build gets its JavaScript from Metro on a
 * developer's machine, which never reads `eas.json` — so local runs need a
 * `.env` file, and `.env.example` holds the dev stack's values ready to copy.
 *
 * There are deliberately no fallbacks. There used to be, and they were the
 * worst kind: a placeholder client id that Cognito rejected with "Invalid
 * client id", and a localhost API URL that nothing was listening on. Both
 * produced an app that looked configured and failed at the first request. A
 * missing value now says so, by name, on screen.
 *
 * None of the three is a secret — they are embedded in every copy of the app —
 * so `.env.example` can carry the real ones.
 */

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

/** Blank counts as absent: an empty `env:` entry is a mistake, not a value. */
const read = (name: string): string | null => {
  const value = env[name];
  return value !== undefined && value.trim() !== '' ? value : null;
};

export const API_URL = read('EXPO_PUBLIC_API_URL');
export const AUTH_DOMAIN = read('EXPO_PUBLIC_AUTH_DOMAIN');
export const USER_POOL_CLIENT_ID = read('EXPO_PUBLIC_USER_POOL_CLIENT_ID');

/**
 * Answer every request from canned fixtures instead of the API, and start signed
 * in — so the real screens can be driven on a real device without a session or a
 * live game. See `src/dev/fixtures.ts`.
 *
 * Guarded twice, and both halves matter. `__DEV__` is false in any release
 * bundle, so a production build cannot reach it however the environment is set;
 * the explicit flag means a developer running the dev client normally still
 * talks to the real API, because a harness that switched itself on would be a
 * trap. It is also never set in `eas.json`, so no build profile can turn it on
 * by accident.
 */
export const DEV_FIXTURES =
  typeof __DEV__ !== 'undefined' && __DEV__ && read('EXPO_PUBLIC_DEV_FIXTURES') === '1';

/** RevenueCat is genuinely optional: without it the app simply sells nothing. */
export const REVENUECAT_KEY = read('EXPO_PUBLIC_REVENUECAT_KEY');

const REQUIRED: Array<[string, string | null]> = [
  ['EXPO_PUBLIC_API_URL', API_URL],
  ['EXPO_PUBLIC_AUTH_DOMAIN', AUTH_DOMAIN],
  ['EXPO_PUBLIC_USER_POOL_CLIENT_ID', USER_POOL_CLIENT_ID],
];

export const missingConfig: string[] = REQUIRED.filter(([, value]) => value === null).map(([name]) => name);

/**
 * A message naming what is missing and how to supply it, or null when the app
 * is configured. Rendered instead of the app, because every screen below the
 * sign-in button would fail in a way that points nowhere near the cause.
 */
export const configError: string | null =
  missingConfig.length === 0
    ? null
    : `Missing ${missingConfig.join(', ')}.\n\nRunning from Metro? Copy apps/mobile/.env.example to apps/mobile/.env and restart with \`pnpm start --dev-client --clear\`.\n\nBuilding with EAS? Add them to the profile's env block in eas.json.`;
