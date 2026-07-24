import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  advanceGame,
  castVote,
  getResults,
  joinByCode,
  listTeams,
  submitChase,
  submitPhoto,
  type Result,
} from './handlers.js';
import { createGameForHost, handlePurchaseWebhook, startGameForHost } from './billing-handlers.js';
import { buildContainer, type Container } from './container.js';

type Body = Record<string, unknown>;
type RouteHandler = (ctx: {
  container: Container;
  params: Record<string, string>;
  body: Body;
}) => Promise<Result<unknown>>;

interface Route {
  method: string;
  regex: RegExp;
  keys: string[];
  handler: RouteHandler;
}

/** Compile a path template (`/games/:id/teams`) into a matcher. */
function compile(method: string, path: string, handler: RouteHandler): Route {
  const keys: string[] = [];
  const pattern = path.replace(/:[^/]+/g, (m) => {
    keys.push(m.slice(1));
    return '([^/]+)';
  });
  return { method, regex: new RegExp(`^${pattern}/?$`), keys, handler };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Core API routes mapped to the existing handler functions. */
const ROUTES: Route[] = [
  compile('POST', '/games', ({ container, body }) => createGameForHost(container.games, container.entitlements, body)),
  compile('POST', '/games/join', ({ container, body }) => joinByCode(container.games, body)),
  compile('GET', '/games/:id/teams', ({ container, params }) => listTeams(container.games, params.id!)),
  compile('POST', '/games/:id/start', ({ container, params, body }) =>
    startGameForHost(container.games, container.entitlements, { gameId: params.id!, hostUserId: str(body.hostUserId) }),
  ),
  compile('POST', '/games/:id/advance', ({ container, params, body }) =>
    advanceGame(container.games, { gameId: params.id!, hostUserId: str(body.hostUserId), event: body.event as never }),
  ),
  compile('POST', '/games/:id/photos', ({ container, params, body }) => submitPhoto(container.games, { ...body, gameId: params.id })),
  compile('POST', '/games/:id/chases', ({ container, params, body }) => submitChase(container.games, { ...body, gameId: params.id })),
  compile('POST', '/games/:id/votes', ({ container, params, body }) => castVote(container.games, { ...body, gameId: params.id })),
  compile('GET', '/games/:id/results', ({ container, params }) => getResults(container.games, params.id!)),
  compile('POST', '/webhooks/purchase', ({ container, body }) => handlePurchaseWebhook(container.entitlements, body)),
];

function json(statusCode: number, payload: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) };
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

  const body = parseBody(event);
  if (body === null) return json(400, { error: 'Invalid JSON body.' });

  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const match = r.regex.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((key, i) => (params[key] = match[i + 1]!));
    try {
      const result = await r.handler({ container, params, body });
      return result.ok ? json(200, result.data) : json(400, { error: result.error });
    } catch (e) {
      return json(500, { error: (e as Error).message });
    }
  }
  return json(404, { error: `No route for ${method} ${path}` });
}

// One container per cold start, reused across invocations.
const container = buildContainer();

/** Lambda entrypoint for the API Gateway HTTP API. */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  return route(event, container);
}
