import { describe, expect, it } from 'vitest';
import { PUBLIC_ROUTES, isPublicRoute, toApiGatewayPath } from './public-routes.js';

/**
 * This table is a security boundary: everything on it is reachable by anyone on
 * the internet. It is also the contract between the Lambda router and the API
 * Gateway routes in infra/cdk, which is why it exists at all — they used to
 * disagree, and the disagreement was invisible until a real deployment.
 */

describe('PUBLIC_ROUTES', () => {
  it('is exactly the two routes that are meant to be open', () => {
    // Pinned deliberately. Adding a route here should require changing this
    // test, so it is a decision rather than an accident.
    expect(PUBLIC_ROUTES).toEqual([
      { method: 'GET', path: '/spectate/:code' },
      { method: 'POST', path: '/webhooks/purchase' },
    ]);
  });
});

describe('isPublicRoute', () => {
  it('recognises the open routes', () => {
    expect(isPublicRoute('GET', '/spectate/:code')).toBe(true);
    expect(isPublicRoute('POST', '/webhooks/purchase')).toBe(true);
  });

  it('does not open a route to a method it was not granted', () => {
    // POST /spectate/:code is not the same route as GET; matching on path alone
    // would hand an unauthenticated caller a write.
    expect(isPublicRoute('POST', '/spectate/:code')).toBe(false);
    expect(isPublicRoute('GET', '/webhooks/purchase')).toBe(false);
  });

  it('keeps everything else authenticated', () => {
    expect(isPublicRoute('POST', '/games')).toBe(false);
    expect(isPublicRoute('GET', '/games/:id/state')).toBe(false);
    expect(isPublicRoute('GET', '/me/entitlement')).toBe(false);
  });

  it('matches the declared path, not a lookalike', () => {
    // The Lambda looks this up by its own route template, so a near-miss must
    // fail closed rather than quietly opening something.
    expect(isPublicRoute('GET', '/spectate')).toBe(false);
    expect(isPublicRoute('GET', '/spectate/:code/photos')).toBe(false);
  });
});

describe('toApiGatewayPath', () => {
  it('rewrites parameters into API Gateway syntax', () => {
    expect(toApiGatewayPath('/spectate/:code')).toBe('/spectate/{code}');
  });

  it('leaves a static path alone', () => {
    expect(toApiGatewayPath('/webhooks/purchase')).toBe('/webhooks/purchase');
  });

  it('rewrites every parameter, not just the first', () => {
    expect(toApiGatewayPath('/games/:id/photos/:photoId')).toBe('/games/{id}/photos/{photoId}');
  });
});
