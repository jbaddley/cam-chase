import { AUTH_DOMAIN, USER_POOL_CLIENT_ID } from './config.js';
import { AuthSession, buildAuthorizeUrl, createPkceChallenge, parseCallbackCode, webCrypto, type AuthConfig, type CryptoSource, type IdentityProvider } from '@photochase/client';

/** Custom scheme registered by the app; must match the Cognito callback URL. */
export const REDIRECT_URI = 'photochase://auth';

// Empty strings rather than placeholders when unset: `App` refuses to render
// the app at all in that case (see src/config.ts), so nothing here is ever
// reached unconfigured — and a blank is at least obviously blank.
const authConfig: AuthConfig = {
  domain: AUTH_DOMAIN ?? '',
  clientId: USER_POOL_CLIENT_ID ?? '',
  redirectUri: REDIRECT_URI,
};

/** The app's single auth session; `client` reads its token on every request. */
export const session = new AuthSession(authConfig);

/**
 * Opens `url` in a native browser sheet (ASWebAuthenticationSession on iOS,
 * Chrome Custom Tabs on Android) and resolves with the callback URL the sheet
 * returns to. Injected rather than imported so the sign-in flow can be driven
 * in tests without a native build — the real implementation is
 * `expo-auth-session`'s `openAuthSessionAsync`, which needs an EAS dev build.
 */
export type Authorizer = (url: string, redirectUri: string) => Promise<string>;

/**
 * Randomness and SHA-256 for PKCE. Web Crypto by default, because that is what
 * a browser and the test harness have; React Native's runtime exposes
 * `crypto.getRandomValues` but **not** `crypto.subtle`, so a native build swaps
 * in an expo-crypto source at startup (see `src/native/auth.ts`).
 *
 * Set rather than injected through the screens: the module already owns the
 * one long-lived {@link session}, and threading a crypto source through the
 * sign-in UI would put a native concern in every component that renders it.
 */
let cryptoSource: CryptoSource = webCrypto;

export function setCryptoSource(source: CryptoSource): void {
  cryptoSource = source;
}

/** Thrown when the user dismisses the sheet without completing sign-in. */
export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in was cancelled.');
    this.name = 'SignInCancelled';
  }
}

/**
 * Run the full native sign-in: mint a PKCE pair, open the provider's page in
 * the sheet, then exchange the returned code for tokens. Naming the provider
 * skips Cognito's chooser, so "Continue with Google" goes straight to Google.
 */
export async function signIn(authorize: Authorizer, provider?: IdentityProvider): Promise<void> {
  const challenge = await createPkceChallenge(cryptoSource);
  const url = buildAuthorizeUrl(authConfig, challenge, provider ? { identityProvider: provider } : {});

  const callbackUrl = await authorize(url, REDIRECT_URI);
  if (!callbackUrl) throw new SignInCancelled();

  const code = parseCallbackCode(callbackUrl);
  await session.completeSignIn({ code, verifier: challenge.verifier });
}

export function signOut(): void {
  session.signOut();
}
