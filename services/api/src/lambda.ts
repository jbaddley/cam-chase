import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import {
  answerCatchClaim,
  castFinalsVote,
  checkIn,
  claimCatch,
  clearFoul,
  flagFoul,
  castVote,
  getFinals,
  getGameState,
  getSpectatorView,
  getResults,
  joinByCode,
  leaveGame,
  getMySecret,
  getTagBrief,
  listAssignments,
  listCatchClaims,
  listGuessTargets,
  listHuntItems,
  listRateable,
  listTeams,
  reportTagPing,
  resolveCatchDispute,
  submitChase,
  submitGuess,
  submitPhoto,
  type Result,
} from './handlers.js';
import { createGameForHost, getMyEntitlement, handlePurchaseWebhook, startGameForHost } from './billing-handlers.js';
import {
  createShareCard,
  getMyReferral,
  redeemReferralCode,
  setSharingConsent,
} from './growth-handlers.js';
import { advanceGameAndSettle } from './game-lifecycle.js';
import { createTournament, generateGameRecap, getStandingsByCode } from './tournament-handlers.js';
import { startDailyHunt } from './solo-handlers.js';
import { requestPhotoDownload, requestPhotoUpload } from './media-handlers.js';
import { authenticate, type AuthContext } from './auth.js';
import { buildContainer, type Container } from './container.js';
import { isPublicRoute } from './public-routes.js';

type Body = Record<string, unknown>;
type RouteHandler = (ctx: {
  container: Container;
  params: Record<string, string>;
  body: Body;
  /** The authenticated identity (from a verified JWT), not the request body. */
  auth: AuthContext;
}) => Promise<Result<unknown>>;

interface Route {
  method: string;
  regex: RegExp;
  keys: string[];
  handler: RouteHandler;
  /** Routes that don't require a user identity (e.g. provider webhooks). */
  isPublic: boolean;
}

/**
 * Compile a path template (`/games/:id/teams`) into a matcher.
 *
 * Whether the route is public is looked up rather than passed in, so this table
 * and the API Gateway routes in infra/cdk cannot disagree — a route the gateway
 * still guards would 401 here long before the handler ran.
 */
function compile(method: string, path: string, handler: RouteHandler): Route {
  const keys: string[] = [];
  const pattern = path.replace(/:[^/]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  });
  return { method, regex: new RegExp(`^${pattern}/?$`), keys, handler, isPublic: isPublicRoute(method, path) };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Provider-signed route; `route` verifies its signature before dispatching. */
const WEBHOOK_PATH = '/webhooks/purchase';

/**
 * Core API routes. The authenticated user (`auth.userId`) is injected into
 * handlers — the request body never supplies its own identity.
 */
const ROUTES: Route[] = [
  compile('POST', '/games', ({ container, body, auth }) =>
    createGameForHost(
      container.games,
      container.entitlements,
      // `host` must be forwarded: it is how the organiser gets a team (or a
      // judge's seat) at creation. It is optional in the schema, so leaving it
      // out here parsed cleanly and silently left a playing host teamless.
      { hostUserId: auth.userId, config: body.config, tournamentCode: body.tournamentCode, host: body.host },
      container.tournaments,
    ),
  ),
  compile('POST', '/games/join', ({ container, body, auth }) => joinByCode(container.games, { ...body, userId: auth.userId })),
  compile('POST', '/games/:id/leave', ({ container, params, auth }) =>
    leaveGame(container.games, { gameId: params.id!, userId: auth.userId }),
  ),
  compile('GET', '/games/:id/teams', ({ container, params }) => listTeams(container.games, params.id!)),
  compile('GET', '/games/:id/assignments', ({ container, params, auth }) =>
    listAssignments(container.games, { gameId: params.id!, userId: auth.userId }),
  ),
  compile('POST', '/games/:id/photos/:photoId/fouls', ({ container, params, body, auth }) =>
    flagFoul(container.games, { ...body, gameId: params.id, photoId: params.photoId, userId: auth.userId }),
  ),
  compile('DELETE', '/games/:id/photos/:photoId/fouls', ({ container, params, body, auth }) =>
    clearFoul(container.games, { ...body, gameId: params.id, photoId: params.photoId, userId: auth.userId }),
  ),
  compile('POST', '/games/:id/checkins', ({ container, params, body, auth }) =>
    checkIn(container.games, { ...body, gameId: params.id, userId: auth.userId }),
  ),
  compile('GET', '/games/:id/finals', ({ container, params, auth }) =>
    getFinals(container.games, { gameId: params.id!, userId: auth.userId }),
  ),
  compile('POST', '/games/:id/finals', ({ container, params, body, auth }) =>
    castFinalsVote(container.games, { ...body, gameId: params.id, voterUserId: auth.userId }),
  ),
  compile('GET', '/games/:id/items', ({ container, params, auth }) =>
    listHuntItems(container.games, { gameId: params.id!, userId: auth.userId }),
  ),
  compile('GET', '/games/:id/secret', ({ container, params, auth }) =>
    getMySecret(container.games, { gameId: params.id!, userId: auth.userId }),
  ),
  compile('GET', '/games/:id/guess-targets', ({ container, params, auth }) =>
    listGuessTargets(container.games, { gameId: params.id!, userId: auth.userId }),
  ),
  compile('POST', '/games/:id/guesses', ({ container, params, body, auth }) =>
    submitGuess(container.games, { ...body, gameId: params.id, userId: auth.userId }),
  ),
  compile('GET', '/games/:id/tag-brief', ({ container, params, auth }) =>
    getTagBrief(container.games, { gameId: params.id!, userId: auth.userId }),
  ),
  compile('POST', '/games/:id/pings', ({ container, params, body, auth }) =>
    reportTagPing(container.games, { ...body, gameId: params.id, userId: auth.userId }),
  ),
  compile('POST', '/games/:id/catches', ({ container, params, body, auth }) =>
    claimCatch(container.games, { ...body, gameId: params.id, hunterUserId: auth.userId }),
  ),
  compile('GET', '/games/:id/catches', ({ container, params, auth }) =>
    listCatchClaims(container.games, { gameId: params.id!, userId: auth.userId }),
  ),
  compile('POST', '/games/:id/catches/:catchId/answer', ({ container, params, body, auth }) =>
    answerCatchClaim(container.games, { ...body, gameId: params.id, catchId: params.catchId, userId: auth.userId }),
  ),
  compile('POST', '/games/:id/catches/:catchId/ruling', ({ container, params, body, auth }) =>
    resolveCatchDispute(container.games, {
      ...body,
      gameId: params.id,
      catchId: params.catchId,
      hostUserId: auth.userId,
    }),
  ),
  compile('GET', '/games/:id/rateable', ({ container, params, auth }) =>
    listRateable(container.games, { gameId: params.id!, userId: auth.userId }),
  ),
  compile('GET', '/games/:id', ({ container, params }) => getGameState(container.games, params.id!)),
  compile('POST', '/games/:id/start', ({ container, params, auth }) =>
    startGameForHost(container.games, container.entitlements, { gameId: params.id!, hostUserId: auth.userId }),
  ),
  compile('POST', '/games/:id/advance', ({ container, params, body, auth }) =>
    advanceGameAndSettle(container, { gameId: params.id!, hostUserId: auth.userId, event: body.event as never }),
  ),
  compile('POST', '/games/:id/consent', ({ container, params, body, auth }) =>
    setSharingConsent(container.games, { ...body, gameId: params.id, userId: auth.userId }),
  ),
  compile('POST', '/games/:id/share-cards', ({ container, params, body, auth }) =>
    createShareCard(container.games, { ...body, gameId: params.id, sharerUserId: auth.userId }),
  ),
  compile('POST', '/games/:id/photos', ({ container, params, body, auth }) =>
    submitPhoto(container.games, { ...body, gameId: params.id, shooterUserId: auth.userId }),
  ),
  compile('POST', '/games/:id/chases', ({ container, params, body, auth }) =>
    submitChase(container.games, { ...body, gameId: params.id, shooterUserId: auth.userId }),
  ),
  compile('POST', '/games/:id/votes', ({ container, params, body, auth }) =>
    castVote(container.games, { ...body, gameId: params.id, voterUserId: auth.userId }),
  ),
  compile('GET', '/games/:id/results', ({ container, params }) => getResults(container.games, params.id!)),
  compile('GET', '/games/:id/recap', ({ container, params }) => generateGameRecap(container.games, { gameId: params.id! })),
  compile('POST', '/games/:id/uploads', ({ container, params, body, auth }) =>
    requestPhotoUpload(container.games, container.media, { gameId: params.id!, teamId: str(body.teamId), userId: auth.userId }),
  ),
  compile('POST', '/games/:id/downloads', ({ container, params, body, auth }) =>
    requestPhotoDownload(container.games, container.media, {
      gameId: params.id!,
      photoId: str(body.photoId),
      userId: auth.userId,
      // Only the one variant is signable, so anything else falls through to the
      // original rather than being trusted into a key.
      ...(body.variant === 'thumb' ? { variant: 'thumb' as const } : {}),
    }),
  ),
  compile('POST', '/tournaments', ({ container, body, auth }) =>
    createTournament(container.tournaments, container.entitlements, { ...body, ownerUserId: auth.userId }),
  ),
  compile('GET', '/tournaments/:code/standings', ({ container, params }) =>
    getStandingsByCode(container.tournaments, params.code!),
  ),
  compile('POST', '/solo/daily', ({ container, auth }) =>
    startDailyHunt(container.games, container.dailyHunts, { userId: auth.userId }),
  ),
  compile('GET', '/me/entitlement', ({ container, auth }) => getMyEntitlement(container.entitlements, auth.userId)),
  compile('GET', '/me/referral', ({ container, auth }) => getMyReferral(container.referrals, auth.userId)),
  compile('POST', '/me/referral/redeem', ({ container, body, auth }) =>
    redeemReferralCode(container.referrals, { ...body, inviteeUserId: auth.userId }),
  ),
  // Big-screen spectator view: reached from a TV browser with nobody signed in.
  compile('GET', '/spectate/:code', ({ container, params }) => getSpectatorView(container.games, params.code!)),
  // Provider-signed, not user-authenticated: the signature is checked in
  // `route` against the raw body before this handler ever runs.
  compile('POST', '/webhooks/purchase', ({ container, body }) => handlePurchaseWebhook(container.entitlements, body)),
];

function json(statusCode: number, payload: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) };
}

/** The body exactly as sent — signatures cover these bytes, not a re-encoding. */
function rawBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) return '';
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

function parseBody(event: APIGatewayProxyEventV2): Body | null {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Body) : {};
  } catch {
    return null;
  }
}

/**
 * Route an API Gateway HTTP API v2 event to a handler and map its `Result` to an
 * HTTP response. Exported for testing; `handler` wraps it with a shared container.
 */
export async function route(
  event: APIGatewayProxyEventV2,
  container: Container,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const requestId = (event.requestContext as { requestId?: string }).requestId ?? randomUUID();
  const log = container.logger.child({ requestId, method, path });
  const startedAt = Date.now();
  log.info('request.start');

  /** Stamp x-request-id on every response and log the request outcome. */
  const finish = (res: APIGatewayProxyStructuredResultV2): APIGatewayProxyStructuredResultV2 => {
    log.info('request.end', { status: res.statusCode, durationMs: Date.now() - startedAt });
    return { ...res, headers: { ...res.headers, 'x-request-id': requestId } };
  };
  const errorResponse = (status: number, message: string) => finish(json(status, { error: message, requestId }));

  const body = parseBody(event);
  if (body === null) return errorResponse(400, 'Invalid JSON body.');

  // The purchase webhook grants entitlements, so it is provider-authenticated
  // rather than open. Verify against the raw bytes before anything is applied —
  // re-serializing the parsed body would not match the provider's signature.
  if (path === WEBHOOK_PATH) {
    const failure = container.webhookVerifier.verify(rawBody(event), event.headers);
    if (failure) {
      log.warn('webhook.rejected', { reason: failure });
      return errorResponse(401, failure);
    }
  }

  const auth = await authenticate(event, container.verifier);

  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const match = r.regex.exec(path);
    if (!match) continue;
    if (!r.isPublic && !auth) return errorResponse(401, 'Unauthorized.');
    const params: Record<string, string> = {};
    r.keys.forEach((key, i) => (params[key] = match[i + 1]!));
    try {
      const result = await r.handler({ container, params, body, auth: auth ?? { userId: '' } });
      return result.ok ? finish(json(200, result.data)) : errorResponse(400, result.error);
    } catch (e) {
      const err = e as Error;
      log.error('request.error', { error: err.message, stack: err.stack });
      return errorResponse(500, err.message);
    }
  }
  return errorResponse(404, `No route for ${method} ${path}`);
}

// One container per cold start, reused across invocations.
const container = buildContainer();

/** Lambda entrypoint for the API Gateway HTTP API. */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  return route(event, container);
}
