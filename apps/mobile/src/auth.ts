import { AuthSession, buildAuthorizeUrl, createPkceChallenge, parseCallbackCode, type AuthConfig, type IdentityProvider } from '@photochase/client';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

/** Custom scheme registered by the app; must match the Cognito callback URL. */
export const REDIRECT_URI = 'photochase://auth';

const authConfig: AuthConfig = {
  domain: env.EXPO_PUBLIC_AUTH_DOMAIN ?? 'https://photochase-dev.auth.us-east-1.amazoncognito.com',
  clientId: env.EXPO_PUBLIC_USER_POOL_CLIENT_ID ?? 'local-dev-client',
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
  const challenge = await createPkceChallenge();
  const url = buildAuthorizeUrl(authConfig, challenge, provider ? { identityProvider: provider } : {});

  const callbackUrl = await authorize(url, REDIRECT_URI);
  if (!callbackUrl) throw new SignInCancelled();

  const code = parseCallbackCode(callbackUrl);
  await session.completeSignIn({ code, verifier: challenge.verifier });
}

export function signOut(): void {
  session.signOut();
}
