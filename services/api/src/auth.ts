import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

/** The authenticated identity derived from a verified Cognito JWT. */
export interface AuthContext {
  userId: string;
  email?: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthContext>;
}

/**
 * Read verified claims injected by an API Gateway HTTP API JWT authorizer
 * (`requestContext.authorizer.jwt.claims`). Returns null when absent.
 */
export function extractClaims(event: APIGatewayProxyEventV2): AuthContext | null {
  const authorizer = (
    event.requestContext as { authorizer?: { jwt?: { claims?: Record<string, unknown> } } }
  ).authorizer;
  const claims = authorizer?.jwt?.claims;
  const sub = claims?.sub;
  if (typeof sub !== 'string' || sub.length === 0) return null;
  return { userId: sub, email: typeof claims?.email === 'string' ? claims.email : undefined };
}

/** Extract a bearer token from the Authorization header. */
export function extractBearerToken(event: APIGatewayProxyEventV2): string | null {
  const header = event.headers?.authorization ?? event.headers?.Authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1]! : null;
}

/** Minimal shape of an aws-jwt-verify verifier (also satisfied by test doubles). */
interface RawVerifier {
  verify(token: string): Promise<{ sub?: string; email?: unknown }>;
}

/**
 * Verifies Cognito JWTs (signature, issuer, audience/client, token_use, expiry)
 * against the pool's JWKS. Construct from pool config in prod, or inject a
 * pre-configured verifier (with a cached JWKS) for offline tests.
 */
export class CognitoTokenVerifier implements TokenVerifier {
  private readonly verifier: RawVerifier;

  constructor(
    opts:
      | { userPoolId: string; clientId: string; tokenUse?: 'access' | 'id' }
      | { verifier: RawVerifier },
  ) {
    this.verifier =
      'verifier' in opts
        ? opts.verifier
        : (CognitoJwtVerifier.create({
            userPoolId: opts.userPoolId,
            clientId: opts.clientId,
            tokenUse: opts.tokenUse ?? 'access',
          }) as RawVerifier);
  }

  async verify(token: string): Promise<AuthContext> {
    const payload = await this.verifier.verify(token);
    if (!payload.sub) throw new Error('Token has no subject.');
    return { userId: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
  }
}

/**
 * Resolve the request's identity: prefer gateway-verified claims; otherwise, if a
 * verifier is configured, validate a bearer token. Returns null if unauthenticated.
 */
export async function authenticate(
  event: APIGatewayProxyEventV2,
  verifier?: TokenVerifier,
): Promise<AuthContext | null> {
  const claims = extractClaims(event);
  if (claims) return claims;
  const token = extractBearerToken(event);
  if (token && verifier) {
    try {
      return await verifier.verify(token);
    } catch {
      return null;
    }
  }
  return null;
}

/** Build a Cognito verifier from env, if the pool/client are configured. */
export function verifierFromEnv(env: NodeJS.ProcessEnv = process.env): TokenVerifier | undefined {
  if (!env.USER_POOL_ID || !env.COGNITO_CLIENT_ID) return undefined;
  return new CognitoTokenVerifier({ userPoolId: env.USER_POOL_ID, clientId: env.COGNITO_CLIENT_ID });
}
