import { FREE_CONFIG } from '@photochase/shared';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildContainer, type Container } from './container.js';
import { makeS3Client, S3MediaService } from './media.js';
import { route } from './lambda.js';

function event(method: string, path: string, body?: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: {},
    requestContext: { http: { method, path } } as APIGatewayProxyEventV2['requestContext'],
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

async function call(container: Container, method: string, path: string, body?: unknown) {
  const res = await route(event(method, path, body), container);
  return { status: res.statusCode, data: JSON.parse((res.body as string) ?? '{}') };
}

let container: Container;
beforeEach(() => {
  container = buildContainer({} as NodeJS.ProcessEnv); // in-memory
});

describe('lambda route', () => {
  it('drives create → join → list → start over HTTP events', async () => {
    const created = await call(container, 'POST', '/games', { hostUserId: 'host', config: FREE_CONFIG });
    expect(created.status).toBe(200);
    const { gameId, code } = created.data;

    expect((await call(container, 'POST', '/games/join', { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } })).status).toBe(200);
    expect((await call(container, 'POST', '/games/join', { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } })).status).toBe(200);

    const teams = await call(container, 'GET', `/games/${gameId}/teams`);
    expect(teams.status).toBe(200);
    expect(teams.data).toHaveLength(2);

    const started = await call(container, 'POST', `/games/${gameId}/start`, { hostUserId: 'host' });
    expect(started.status).toBe(200);
    expect(started.data.state).toBe('round1_active');
  });

  it('maps handler errors to 400', async () => {
    const res = await call(container, 'POST', '/games', { hostUserId: '', config: FREE_CONFIG });
    expect(res.status).toBe(400);
    expect(res.data.error).toBeDefined();
  });

  it('returns 404 for an unknown route', async () => {
    expect((await call(container, 'GET', '/nope')).status).toBe(404);
  });

  it('returns 400 for invalid JSON', async () => {
    const bad = { ...event('POST', '/games'), body: '{not json' } as APIGatewayProxyEventV2;
    const res = await route(bad, container);
    expect(res.statusCode).toBe(400);
  });

  it('issues a presigned photo upload over the route', async () => {
    // Override media with credentialed presigning (offline).
    const c: Container = {
      ...buildContainer({} as NodeJS.ProcessEnv),
      media: new S3MediaService(
        makeS3Client({ region: 'us-east-1', credentials: { accessKeyId: 'AKIATEST', secretAccessKey: 'secret' } }),
        'photochase-photos-dev',
      ),
    };
    const { gameId, code } = (await call(c, 'POST', '/games', { hostUserId: 'host', config: FREE_CONFIG })).data;
    await call(c, 'POST', '/games/join', { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } });
    await call(c, 'POST', '/games/join', { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } });
    await call(c, 'POST', `/games/${gameId}/start`, { hostUserId: 'host' });
    const teams = await call(c, 'GET', `/games/${gameId}/teams`);
    const teamA = (teams.data as Array<{ teamId: string; name: string }>).find((t) => t.name === 'A')!.teamId;

    const up = await call(c, 'POST', `/games/${gameId}/uploads`, { teamId: teamA, userId: 'uA' });
    expect(up.status).toBe(200);
    expect(up.data.key).toContain(`games/${gameId}/${teamA}/`);
    expect(up.data.upload.fields.key).toBe(up.data.key);
  });

  it('handles the purchase webhook', async () => {
    const res = await call(container, 'POST', '/webhooks/purchase', { userId: 'u', event: { type: 'game_pack_purchased', credits: 2 } });
    expect(res.status).toBe(200);
    expect(res.data.tier).toBe('game_pack');
  });
});
