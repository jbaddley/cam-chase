import { describe, expect, it } from 'vitest';
import {
  AuthSession,
  base64UrlEncode,
  buildAuthorizeUrl,
  createPkceChallenge,
  exchangeCodeForTokens,
  parseCallbackCode,
  refreshTokens,
  subjectOf,
  type AuthConfig,
  type CryptoSource,
} from './auth.js';
import type { FetchFn } from './http.js';

const DOMAIN = 'https://photochase-dev.auth.us-east-1.amazoncognito.com';

interface Call {
  url: string;
  init?: RequestInit;
}

/** Deterministic crypto: fixed bytes in, predictable challenge out. */
const fakeCrypto: CryptoSource = {
  randomBytes: (length) => new Uint8Array(Array.from({ length }, (_, i) => i)),
  sha256: (input) => Promise.resolve(new Uint8Array(Array.from({ length: 32 }, (_, i) => (i + input.length) % 256))),
};

function config(fetch?: FetchFn): AuthConfig {
  return { domain: DOMAIN, clientId: 'client-123', redirectUri: 'photochase://auth', ...(fetch ? { fetch } : {}) };
}

/** A token endpoint double that records its calls. */
function tokenEndpoint(body: unknown, status = 200): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchFn = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
  };
  return { fetch, calls };
}

const TOKENS = { access_token: 'access-1', id_token: 'id-1', refresh_token: 'refresh-1', expires_in: 3600 };

describe('base64UrlEncode', () => {
  it('produces URL-safe output with no padding', () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 190, 255]));
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded).toBe('-_--_w');
  });
});

describe('createPkceChallenge', () => {
  it('derives an S256 challenge from the verifier', async () => {
    const challenge = await createPkceChallenge(fakeCrypto);
    expect(challenge.method).toBe('S256');
    expect(challenge.verifier).not.toMatch(/[+/=]/);
    expect(challenge.challenge).not.toMatch(/[+/=]/);
    expect(challenge.challenge).not.toBe(challenge.verifier);
  });

  it('is deterministic for a given crypto source', async () => {
    const a = await createPkceChallenge(fakeCrypto);
    const b = await createPkceChallenge(fakeCrypto);
    expect(a).toEqual(b);
  });
});

describe('buildAuthorizeUrl', () => {
  it('includes the PKCE challenge and the code response type', async () => {
    const challenge = await createPkceChallenge(fakeCrypto);
    const url = new URL(buildAuthorizeUrl(config(), challenge));

    expect(url.origin).toBe(DOMAIN);
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe('photochase://auth');
    expect(url.searchParams.get('code_challenge')).toBe(challenge.challenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('identity_provider')).toBeNull();
  });

  it('jumps straight to a provider when one is named', async () => {
    const challenge = await createPkceChallenge(fakeCrypto);
    const url = new URL(buildAuthorizeUrl(config(), challenge, { identityProvider: 'SignInWithApple', state: 'xyz' }));
    expect(url.searchParams.get('identity_provider')).toBe('SignInWithApple');
    expect(url.searchParams.get('state')).toBe('xyz');
  });
});

describe('parseCallbackCode', () => {
  it('extracts the code', () => {
    expect(parseCallbackCode('photochase://auth?code=abc123&state=xyz')).toBe('abc123');
  });

  it('throws the provider error description when the user declines', () => {
    expect(() => parseCallbackCode('photochase://auth?error=access_denied&error_description=User%20cancelled')).toThrow(
      'User cancelled',
    );
  });

  it('throws when no code is present', () => {
    expect(() => parseCallbackCode('photochase://auth')).toThrow(/no code/i);
  });
});

describe('exchangeCodeForTokens', () => {
  it('posts the code and verifier as form data', async () => {
    const { fetch, calls } = tokenEndpoint(TOKENS);
    const tokens = await exchangeCodeForTokens(config(fetch), { code: 'abc', verifier: 'v1' }, () => 1_000);

    expect(calls[0]!.url).toBe(`${DOMAIN}/oauth2/token`);
    expect(calls[0]!.init?.method).toBe('POST');
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');

    const form = new URLSearchParams(calls[0]!.init!.body as string);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('abc');
    expect(form.get('code_verifier')).toBe('v1');
    expect(form.get('client_id')).toBe('client-123');
    expect(form.get('redirect_uri')).toBe('photochase://auth');

    expect(tokens.accessToken).toBe('access-1');
    expect(tokens.idToken).toBe('id-1');
    expect(tokens.refreshToken).toBe('refresh-1');
    // expires_in is seconds from now.
    expect(tokens.expiresAt).toBe(1_000 + 3_600_000);
  });

  it('surfaces the provider error description on failure', async () => {
    const { fetch } = tokenEndpoint({ error: 'invalid_grant', error_description: 'Code expired' }, 400);
    await expect(exchangeCodeForTokens(config(fetch), { code: 'bad', verifier: 'v' })).rejects.toThrow('Code expired');
  });
});

describe('refreshTokens', () => {
  it('posts the refresh grant', async () => {
    const { fetch, calls } = tokenEndpoint({ access_token: 'access-2', id_token: 'id-2', expires_in: 3600 });
    const tokens = await refreshTokens(config(fetch), 'refresh-1', () => 5_000);

    const form = new URLSearchParams(calls[0]!.init!.body as string);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('refresh-1');
    expect(tokens.accessToken).toBe('access-2');
    expect(tokens.expiresAt).toBe(5_000 + 3_600_000);
  });
});

describe('AuthSession', () => {
  it('starts signed out and returns no token', async () => {
    const session = new AuthSession(config());
    expect(session.isSignedIn).toBe(false);
    expect(session.isExpired()).toBe(true);
    expect(await session.getAccessToken()).toBeNull();
  });

  it('completes sign-in from a code and then serves the token', async () => {
    const { fetch } = tokenEndpoint(TOKENS);
    const session = new AuthSession(config(fetch), () => 0);
    await session.completeSignIn({ code: 'abc', verifier: 'v1' });

    expect(session.isSignedIn).toBe(true);
    expect(session.isExpired()).toBe(false);
    expect(await session.getAccessToken()).toBe('access-1');
  });

  it('treats a token inside the expiry skew as expired', async () => {
    const session = new AuthSession(config(), () => 0);
    session.setTokens({ accessToken: 'a', idToken: 'i', refreshToken: 'r', expiresAt: 30_000 }); // < 60s skew
    expect(session.isExpired()).toBe(true);
  });

  it('refreshes automatically when the access token has expired', async () => {
    const { fetch, calls } = tokenEndpoint({ access_token: 'access-2', id_token: 'id-2', expires_in: 3600 });
    const session = new AuthSession(config(fetch), () => 100_000);
    session.setTokens({ accessToken: 'stale', idToken: 'i', refreshToken: 'refresh-1', expiresAt: 50_000 });

    expect(await session.getAccessToken()).toBe('access-2');
    expect(calls).toHaveLength(1);
    // Cognito omits the refresh token on refresh; the existing one is kept.
    expect(session.current?.refreshToken).toBe('refresh-1');
  });

  it('collapses concurrent refreshes into a single request', async () => {
    const { fetch, calls } = tokenEndpoint({ access_token: 'access-2', id_token: 'id-2', expires_in: 3600 });
    const session = new AuthSession(config(fetch), () => 100_000);
    session.setTokens({ accessToken: 'stale', idToken: 'i', refreshToken: 'refresh-1', expiresAt: 50_000 });

    const [a, b, c] = await Promise.all([
      session.getAccessToken(),
      session.getAccessToken(),
      session.getAccessToken(),
    ]);
    expect([a, b, c]).toEqual(['access-2', 'access-2', 'access-2']);
    expect(calls).toHaveLength(1);
  });

  it('ends the session when the refresh is rejected', async () => {
    const { fetch } = tokenEndpoint({ error: 'invalid_grant' }, 400);
    const session = new AuthSession(config(fetch), () => 100_000);
    session.setTokens({ accessToken: 'stale', idToken: 'i', refreshToken: 'dead', expiresAt: 50_000 });

    expect(await session.getAccessToken()).toBeNull();
    expect(session.isSignedIn).toBe(false);
  });

  it('ends the session when expired with no refresh token', async () => {
    const session = new AuthSession(config(), () => 100_000);
    session.setTokens({ accessToken: 'stale', idToken: 'i', expiresAt: 50_000 });
    expect(await session.getAccessToken()).toBeNull();
    expect(session.isSignedIn).toBe(false);
  });

  it('forgets everything on sign-out', async () => {
    const { fetch } = tokenEndpoint(TOKENS);
    const session = new AuthSession(config(fetch), () => 0);
    await session.completeSignIn({ code: 'abc', verifier: 'v1' });
    session.signOut();
    expect(session.isSignedIn).toBe(false);
    expect(await session.getAccessToken()).toBeNull();
  });
});

describe('subjectOf', () => {
  /** A minimal unsigned id token: only the payload is ever read. */
  const token = (payload: unknown) =>
    `header.${base64UrlEncode(Uint8Array.from(JSON.stringify(payload), (c) => c.charCodeAt(0)))}.signature`;

  it('reads the user id from the claims', () => {
    expect(subjectOf(token({ sub: 'user-7', email: 'a@b.c' }))).toBe('user-7');
  });

  it('decodes a payload that uses the base64url alphabet', () => {
    // A `sub` containing `-` and `_` after encoding is exactly the case a
    // plain atob would mangle.
    const sub = 'us-east-1:ab??cd>>ef';
    expect(subjectOf(token({ sub }))).toBe(sub);
  });

  it.each([
    ['not a token at all', 'nonsense'],
    ['a token with no payload segment', 'header'],
    ['a payload that is not base64', 'header.!!!!.sig'],
    ['a payload that is not JSON', `header.${base64UrlEncode(Uint8Array.from('hello', (c) => c.charCodeAt(0)))}.sig`],
  ])('returns null for %s rather than throwing', (_label, value) => {
    expect(subjectOf(value)).toBeNull();
  });

  it('returns null when the claim is missing or empty', () => {
    // Better an unknown user than an empty-string one, which would look like a
    // real id to whatever it is handed to.
    expect(subjectOf(token({ email: 'a@b.c' }))).toBeNull();
    expect(subjectOf(token({ sub: '' }))).toBeNull();
  });
});

describe('AuthSession.userId', () => {
  it('is null when signed out and the subject once signed in', () => {
    const session = new AuthSession(config(), () => 0);
    expect(session.userId).toBeNull();

    const payload = base64UrlEncode(Uint8Array.from(JSON.stringify({ sub: 'user-9' }), (c) => c.charCodeAt(0)));
    session.setTokens({ accessToken: 'a', idToken: `h.${payload}.s`, expiresAt: 1 });
    expect(session.userId).toBe('user-9');
  });
});
