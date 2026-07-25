import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { authenticate, CognitoTokenVerifier, extractBearerToken, extractClaims } from './auth.js';

const REGION = 'us-east-1';
const USER_POOL_ID = 'us-east-1_test123';
const CLIENT_ID = 'client123';
const ISS = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;

function eventWithClaims(claims?: Record<string, string>, headers?: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: '/games',
    headers: headers ?? {},
    requestContext: claims ? { authorizer: { jwt: { claims } } } : {},
  } as unknown as APIGatewayProxyEventV2;
}

describe('extractClaims', () => {
  it('reads sub and email from gateway claims', () => {
    expect(extractClaims(eventWithClaims({ sub: 'user-1', email: 'a@b.com' }))).toEqual({ userId: 'user-1', email: 'a@b.com' });
  });

  it('returns null without claims or sub', () => {
    expect(extractClaims(eventWithClaims())).toBeNull();
    expect(extractClaims(eventWithClaims({ email: 'a@b.com' }))).toBeNull();
  });
});

describe('extractBearerToken', () => {
  it('parses the Authorization header', () => {
    expect(extractBearerToken(eventWithClaims(undefined, { authorization: 'Bearer abc.def.ghi' }))).toBe('abc.def.ghi');
    expect(extractBearerToken(eventWithClaims(undefined, {}))).toBeNull();
  });
});

describe('CognitoTokenVerifier (offline)', () => {
  let privateKey: KeyLike;
  let verifier: CognitoTokenVerifier;

  async function sign(claims: Record<string, unknown>, opts: { exp?: number; clientId?: string } = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    // Cognito access tokens carry the app client in `client_id` (not `aud`).
    return new SignJWT({ token_use: 'access', client_id: opts.clientId ?? CLIENT_ID, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'testkid' })
      .setIssuer(ISS)
      .setSubject((claims.sub as string) ?? 'user-sub')
      .setIssuedAt(now)
      .setExpirationTime(opts.exp ?? now + 3600)
      .sign(privateKey);
  }

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    const jwk = await exportJWK(pair.publicKey);
    jwk.kid = 'testkid';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const raw = CognitoJwtVerifier.create({ userPoolId: USER_POOL_ID, tokenUse: 'access', clientId: CLIENT_ID });
    raw.cacheJwks({ keys: [jwk as never] });
    verifier = new CognitoTokenVerifier({ verifier: raw });
  });

  it('accepts a valid token and returns the identity', async () => {
    const token = await sign({ sub: 'user-42' });
    expect(await verifier.verify(token)).toEqual({ userId: 'user-42', email: undefined });
  });

  it('rejects an expired token', async () => {
    const token = await sign({ sub: 'user-42' }, { exp: Math.floor(Date.now() / 1000) - 10 });
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(Error);
  });

  it('rejects a token for the wrong app client', async () => {
    const token = await sign({ sub: 'user-42' }, { clientId: 'someone-elses-client' });
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(Error);
  });

  it('rejects a tampered token', async () => {
    const token = (await sign({ sub: 'user-42' })).slice(0, -3) + 'xxx';
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(Error);
  });

  describe('authenticate', () => {
    it('prefers gateway claims', async () => {
      expect(await authenticate(eventWithClaims({ sub: 'from-claims' }), verifier)).toEqual({ userId: 'from-claims', email: undefined });
    });

    it('falls back to verifying a bearer token', async () => {
      const token = await sign({ sub: 'from-token' });
      const event = eventWithClaims(undefined, { authorization: `Bearer ${token}` });
      expect(await authenticate(event, verifier)).toEqual({ userId: 'from-token', email: undefined });
    });

    it('returns null when unauthenticated', async () => {
      expect(await authenticate(eventWithClaims(), verifier)).toBeNull();
    });
  });
});
