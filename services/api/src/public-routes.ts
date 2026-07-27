/**
 * The only routes served without a bearer token.
 *
 * This list is shared by the two places that must agree about it: the Lambda
 * router, which decides whether to demand a verified user, and the CDK stack,
 * which decides whether API Gateway's JWT authorizer runs at all. Before this
 * existed they disagreed — the router treated `/spectate/:code` as public while
 * the gateway rejected it, so the big-screen spectator view (docs/01) was
 * unreachable on a deployed stack even though every test passed. Nothing but a
 * real deployment could catch that, because each side was correct alone.
 *
 * Adding a route here makes it reachable by anyone on the internet. Both of
 * these are deliberate: a spectator view is meant to be opened by a room full
 * of people who are not signed in, and a provider webhook is called by the
 * provider, which proves itself by signature instead (see webhook-auth.ts).
 */
export interface PublicRoute {
  method: 'GET' | 'POST';
  /** Router-style path; `:name` marks a parameter. */
  path: string;
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { method: 'GET', path: '/spectate/:code' },
  { method: 'POST', path: '/webhooks/purchase' },
];

/** True when this router-style path is served without authentication. */
export function isPublicRoute(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some((r) => r.method === method && r.path === path);
}

/**
 * The same path in API Gateway's syntax, which brackets parameters:
 * `/spectate/:code` → `/spectate/{code}`.
 */
export function toApiGatewayPath(path: string): string {
  return path.replace(/:([^/]+)/g, '{$1}');
}
