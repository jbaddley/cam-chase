/**
 * Cognito authorization-code + PKCE flow.
 *
 * The API verifies Cognito User Pool JWTs, and User Pools federate Google,
 * Facebook, and X only through the OAuth2 authorize endpoint — there is no API
 * to trade a provider SDK token for user-pool JWTs. So the app opens the
 * authorize URL in a native browser sheet (ASWebAuthenticationSession / Chrome
 * Custom Tabs) and exchanges the returned code here. Everything below is pure
 * and injectable, so the whole flow is testable without a native build.
 */

import { ApiError, type FetchFn } from './http.js';

/**
 * Identity providers configured on the user pool. These are Cognito provider
 * names, not brand names — X federates as `TwitterX` because Cognito rejects
 * provider names shorter than three characters.
 */
export type IdentityProvider = 'Google' | 'Facebook' | 'SignInWithApple' | 'TwitterX';

export interface AuthConfig {
  /** Cognito domain, e.g. `https://photochase-dev.auth.us-east-1.amazoncognito.com`. */
  domain: string;
  clientId: string;
  /** Custom scheme URL the browser sheet returns to, e.g. `photochase://auth`. */
  redirectUri: string;
  scopes?: string[];
  fetch?: FetchFn;
}

const DEFAULT_SCOPES = ['openid', 'email', 'profile'];

/** A PKCE verifier and its derived challenge. */
export interface PkceChallenge {
  verifier: string;
  challenge: string;
  method: 'S256';
}

/** Randomness and hashing, injectable so tests are deterministic. */
export interface CryptoSource {
  randomBytes: (length: number) => Uint8Array;
  sha256: (input: string) => Promise<Uint8Array>;
}

/** Web Crypto implementation; present in browsers and React Native runtimes. */
export const webCrypto: CryptoSource = {
  randomBytes: (length) => globalThis.crypto.getRandomValues(new Uint8Array(length)),
  sha256: async (input) => {
    const data = new TextEncoder().encode(input);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(digest);
  },
};

/** base64url per RFC 7636 — no padding, URL-safe alphabet. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Create a PKCE verifier/challenge pair. The verifier is kept by the app and
 * sent with the code exchange, proving the same client that started the flow is
 * finishing it — which is what makes a public client safe without a secret.
 */
export async function createPkceChallenge(crypto: CryptoSource = webCrypto): Promise<PkceChallenge> {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(await crypto.sha256(verifier));
  return { verifier, challenge, method: 'S256' };
}

/**
 * Build the authorize URL. Passing `identityProvider` sends the user straight
 * to that provider instead of Cognito's chooser, which is what makes this feel
 * native — one tap on "Continue with Google" goes to Google.
 */
export function buildAuthorizeUrl(
  config: AuthConfig,
  challenge: PkceChallenge,
  options: { identityProvider?: IdentityProvider; state?: string } = {},
): string {
  const url = new URL('/oauth2/authorize', config.domain);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', (config.scopes ?? DEFAULT_SCOPES).join(' '));
  url.searchParams.set('code_challenge', challenge.challenge);
  url.searchParams.set('code_challenge_method', challenge.method);
  if (options.identityProvider) url.searchParams.set('identity_provider', options.identityProvider);
  if (options.state) url.searchParams.set('state', options.state);
  return url.toString();
}

/** Pull the `code` out of the callback URL the browser sheet returns. */
export function parseCallbackCode(callbackUrl: string): string {
  const url = new URL(callbackUrl);
  const error = url.searchParams.get('error');
  if (error) throw new Error(url.searchParams.get('error_description') ?? error);
  const code = url.searchParams.get('code');
  if (!code) throw new Error('Authorization callback contained no code.');
  return code;
}

/** The token set Cognito returns. */
export interface TokenSet {
  accessToken: string;
  idToken: string;
  /** Absent on refresh responses, which reuse the existing refresh token. */
  refreshToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function postToken(
  config: AuthConfig,
  body: Record<string, string>,
  now: () => number,
): Promise<TokenSet> {
  const doFetch = config.fetch ?? (globalThis.fetch as FetchFn);
  const res = await doFetch(new URL('/oauth2/token', config.domain).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const description = (data as { error_description?: unknown; error?: unknown } | undefined) ?? {};
    const message =
      typeof description.error_description === 'string'
        ? description.error_description
        : typeof description.error === 'string'
          ? description.error
          : `Token request failed with status ${res.status}`;
    throw new ApiError(res.status, message);
  }

  const tokens = data as TokenResponse;
  return {
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    expiresAt: now() + tokens.expires_in * 1000,
  };
}

/** Trade an authorization code for tokens, proving possession of the verifier. */
export function exchangeCodeForTokens(
  config: AuthConfig,
  input: { code: string; verifier: string },
  now: () => number = Date.now,
): Promise<TokenSet> {
  return postToken(
    config,
    {
      grant_type: 'authorization_code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code: input.code,
      code_verifier: input.verifier,
    },
    now,
  );
}

/** Exchange a refresh token for a fresh access/id token pair. */
export function refreshTokens(
  config: AuthConfig,
  refreshToken: string,
  now: () => number = Date.now,
): Promise<TokenSet> {
  return postToken(config, { grant_type: 'refresh_token', client_id: config.clientId, refresh_token: refreshToken }, now);
}

/** Refresh this long before actual expiry, so a request never races the clock. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Holds the current token set and keeps it usable. `getAccessToken` is what
 * feeds `ClientConfig.getToken`, so callers never handle a stale token: a
 * single in-flight refresh is shared rather than stampeding.
 */
export class AuthSession {
  private tokens: TokenSet | null = null;
  private refreshing: Promise<TokenSet> | null = null;

  constructor(
    private readonly config: AuthConfig,
    private readonly now: () => number = Date.now,
  ) {}

  get current(): TokenSet | null {
    return this.tokens;
  }

  get isSignedIn(): boolean {
    return this.tokens !== null;
  }

  /** Adopt a token set, e.g. one restored from device storage. */
  setTokens(tokens: TokenSet | null): void {
    this.tokens = tokens;
  }

  signOut(): void {
    this.tokens = null;
    this.refreshing = null;
  }

  /** True when the access token is gone, expired, or about to expire. */
  isExpired(): boolean {
    if (!this.tokens) return true;
    return this.tokens.expiresAt - EXPIRY_SKEW_MS <= this.now();
  }

  /** Complete a sign-in by exchanging the code from the browser sheet. */
  async completeSignIn(input: { code: string; verifier: string }): Promise<TokenSet> {
    const tokens = await exchangeCodeForTokens(this.config, input, this.now);
    this.tokens = tokens;
    return tokens;
  }

  /**
   * A usable access token, refreshing first if needed. Returns null when signed
   * out, so the client simply sends no Authorization header.
   */
  async getAccessToken(): Promise<string | null> {
    if (!this.tokens) return null;
    if (!this.isExpired()) return this.tokens.accessToken;
    if (!this.tokens.refreshToken) {
      this.tokens = null; // expired with no way back; force a fresh sign-in
      return null;
    }

    // Collapse concurrent refreshes into one request.
    this.refreshing ??= refreshTokens(this.config, this.tokens.refreshToken, this.now);
    try {
      const refreshed = await this.refreshing;
      // Cognito omits the refresh token on refresh; keep the one we have.
      this.tokens = { ...refreshed, refreshToken: refreshed.refreshToken ?? this.tokens.refreshToken };
      return this.tokens.accessToken;
    } catch {
      this.tokens = null; // refresh rejected: the session is over
      return null;
    } finally {
      this.refreshing = null;
    }
  }
}
