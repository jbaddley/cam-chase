import { FREE_CONFIG } from '@photochase/shared';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildContainer, type Container } from './container.js';
import { makeS3Client, S3MediaService } from './media.js';
import { route } from './lambda.js';

/** Build an event, optionally authenticated as `userId` (gateway-verified claims). */
function event(method: string, path: string, body?: unknown, userId?: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: path,
    headers: {},
    requestContext: {
      http: { method, path },
      ...(userId ? { authorizer: { jwt: { claims: { sub: userId } } } } : {}),
    } as APIGatewayProxyEventV2['requestContext'],
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

async function call(container: Container, method: string, path: string, body?: unknown, userId?: string) {
  const res = await route(event(method, path, body, userId), container);
  return { status: res.statusCode, data: JSON.parse((res.body as string) ?? '{}') };
}

let container: Container;
beforeEach(() => {
  container = buildContainer({} as NodeJS.ProcessEnv); // in-memory, no verifier
});

describe('lambda route (authenticated)', () => {
  it('drives create → join → list → start using the token identity', async () => {
    // Note: no userId/hostUserId in any body — identity comes from the token.
    const created = await call(container, 'POST', '/games', { config: FREE_CONFIG }, 'host');
    expect(created.status).toBe(200);
    const { gameId, code } = created.data;

    expect((await call(container, 'POST', '/games/join', { code, displayName: 'A', action: { type: 'create_team', name: 'A' } }, 'uA')).status).toBe(200);
    expect((await call(container, 'POST', '/games/join', { code, displayName: 'B', action: { type: 'create_team', name: 'B' } }, 'uB')).status).toBe(200);

    const teams = await call(container, 'GET', `/games/${gameId}/teams`, undefined, 'host');
    expect(teams.data).toHaveLength(2);

    const started = await call(container, 'POST', `/games/${gameId}/start`, {}, 'host');
    expect(started.status).toBe(200);
    expect(started.data.state).toBe('round1_active');
  });

  it('returns 401 for an unauthenticated request to a protected route', async () => {
    const res = await call(container, 'POST', '/games', { config: FREE_CONFIG }); // no userId
    expect(res.status).toBe(401);
  });

  it('maps handler errors to 400', async () => {
    const res = await call(container, 'POST', '/games', {}, 'host'); // missing config
    expect(res.status).toBe(400);
    expect(res.data.error).toBeDefined();
  });

  it('returns 404 for an unknown route', async () => {
    expect((await call(container, 'GET', '/nope', undefined, 'host')).status).toBe(404);
  });

  it('serves the caller team’s Round 2 queue at GET /games/:id/assignments', async () => {
    const { gameId, code } = (await call(container, 'POST', '/games', { config: FREE_CONFIG }, 'host')).data;
    await call(container, 'POST', '/games/join', { code, displayName: 'A', action: { type: 'create_team', name: 'A' } }, 'uA');
    await call(container, 'POST', '/games/join', { code, displayName: 'B', action: { type: 'create_team', name: 'B' } }, 'uB');
    await call(container, 'POST', `/games/${gameId}/start`, {}, 'host');

    const teams = (await call(container, 'GET', `/games/${gameId}/teams`, undefined, 'host')).data as Array<{
      teamId: string;
      name: string;
    }>;
    const teamOf = (name: string) => teams.find((t) => t.name === name)!.teamId;
    for (let i = 0; i < FREE_CONFIG.photosPerRound; i++) {
      await call(container, 'POST', `/games/${gameId}/photos`, { teamId: teamOf('A'), location: { lat: 40, lng: -74 }, s3Key: `a${i}` }, 'uA');
      await call(container, 'POST', `/games/${gameId}/photos`, { teamId: teamOf('B'), location: { lat: 41, lng: -75 }, s3Key: `b${i}` }, 'uB');
    }
    await call(container, 'POST', `/games/${gameId}/advance`, { event: 'END_ROUND1' }, 'host');
    await call(container, 'POST', `/games/${gameId}/advance`, { event: 'COMPLETE_RETURN1' }, 'host');

    const mine = await call(container, 'GET', `/games/${gameId}/assignments`, undefined, 'uA');
    expect(mine.status).toBe(200);
    expect(mine.data).toHaveLength(FREE_CONFIG.photosPerRound);
    expect(mine.data[0].assignmentId).toBeDefined();
    expect(mine.data[0].originalPhotoKey).toMatch(/^b/); // A chases B's photos
  });

  it('serves the sanitized game state at GET /games/:id', async () => {
    const { gameId, code } = (await call(container, 'POST', '/games', { config: FREE_CONFIG }, 'host')).data;
    await call(container, 'POST', '/games/join', { code, displayName: 'A', action: { type: 'create_team', name: 'A' } }, 'uA');

    const res = await call(container, 'GET', `/games/${gameId}`, undefined, 'uA');
    expect(res.status).toBe(200);
    expect(res.data.id).toBe(gameId);
    expect(res.data.state).toBe('lobby');
    expect(res.data.teams).toHaveLength(1);
    expect(res.data.playerCount).toBe(1);
    expect(res.data).not.toHaveProperty('hostUserId');
  });

  it('returns 400 for invalid JSON', async () => {
    const bad = { ...event('POST', '/games', undefined, 'host'), body: '{not json' } as APIGatewayProxyEventV2;
    expect((await route(bad, container)).statusCode).toBe(400);
  });

  it('issues a presigned photo upload for the authenticated team member', async () => {
    const c: Container = {
      ...buildContainer({} as NodeJS.ProcessEnv),
      media: new S3MediaService(
        makeS3Client({ region: 'us-east-1', credentials: { accessKeyId: 'AKIATEST', secretAccessKey: 'secret' } }),
        'photochase-photos-dev',
      ),
    };
    const { gameId, code } = (await call(c, 'POST', '/games', { config: FREE_CONFIG }, 'host')).data;
    await call(c, 'POST', '/games/join', { code, displayName: 'A', action: { type: 'create_team', name: 'A' } }, 'uA');
    await call(c, 'POST', '/games/join', { code, displayName: 'B', action: { type: 'create_team', name: 'B' } }, 'uB');
    await call(c, 'POST', `/games/${gameId}/start`, {}, 'host');
    const teams = await call(c, 'GET', `/games/${gameId}/teams`, undefined, 'host');
    const teamA = (teams.data as Array<{ teamId: string; name: string }>).find((t) => t.name === 'A')!.teamId;

    const up = await call(c, 'POST', `/games/${gameId}/uploads`, { teamId: teamA }, 'uA');
    expect(up.status).toBe(200);
    expect(up.data.key).toContain(`games/${gameId}/${teamA}/`);
  });

  it('handles the purchase webhook without authentication', async () => {
    const res = await call(container, 'POST', '/webhooks/purchase', { userId: 'u', event: { type: 'game_pack_purchased', credits: 2 } });
    expect(res.status).toBe(200);
    expect(res.data.tier).toBe('game_pack');
  });
});
