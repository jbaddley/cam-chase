import { freeEntitlement, FREE_CONFIG } from '@photochase/shared';
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

  it('serves the hunt list at GET /games/:id/items, wildcard withheld', async () => {
    // The hunt is a paid mode, so the host needs an entitlement that has it.
    await container.entitlements.save({ ...freeEntitlement('host'), tier: 'unlimited', subscriptionActive: true });
    const config = { ...FREE_CONFIG, mode: 'scavenger_hunt' as const, huntTheme: 'city' as const };

    const { gameId, code } = (await call(container, 'POST', '/games', { config }, 'host')).data;
    await call(container, 'POST', '/games/join', { code, displayName: 'A', action: { type: 'create_team', name: 'A' } }, 'uA');

    const res = await call(container, 'GET', `/games/${gameId}/items`, undefined, 'uA');
    expect(res.status).toBe(200);
    expect(res.data.items).toHaveLength(config.photosPerRound);
    expect(res.data.items.some((i: { wildcard: boolean }) => i.wildcard)).toBe(false);
  });

  it('refuses the hunt list to someone outside the game', async () => {
    await container.entitlements.save({ ...freeEntitlement('host'), tier: 'unlimited', subscriptionActive: true });
    const config = { ...FREE_CONFIG, mode: 'scavenger_hunt' as const };
    const { gameId } = (await call(container, 'POST', '/games', { config }, 'host')).data;

    expect((await call(container, 'GET', `/games/${gameId}/items`, undefined, 'stranger')).status).toBe(400);
    expect((await call(container, 'GET', `/games/${gameId}/items`)).status).toBe(401);
  });

  it('serves the caller’s referral standing at GET /me/referral', async () => {
    const res = await call(container, 'GET', '/me/referral', undefined, 'r1');
    expect(res.status).toBe(200);
    expect(res.data.code).toHaveLength(6);
    expect(res.data.creditedReferrals).toBe(0);
    expect((await call(container, 'GET', '/me/referral')).status).toBe(401);
  });

  it('redeems an invite code as the authenticated invitee', async () => {
    const { code } = (await call(container, 'GET', '/me/referral', undefined, 'r1')).data;

    const redeemed = await call(container, 'POST', '/me/referral/redeem', { code }, 'i1');
    expect(redeemed.status).toBe(200);
    expect(redeemed.data.attributed).toBe(true);
    // The body never names the invitee; the token does.
    expect((await container.referrals.findByInvitee('i1'))!.referrerUserId).toBe('r1');
  });

  it('records sharing consent for the token’s owner, not the body’s', async () => {
    const { gameId, code } = (await call(container, 'POST', '/games', { config: FREE_CONFIG }, 'host')).data;
    await call(container, 'POST', '/games/join', { code, displayName: 'A', action: { type: 'create_team', name: 'A' } }, 'uA');

    const res = await call(container, 'POST', `/games/${gameId}/consent`, { consent: true, userId: 'someone-else' }, 'uA');
    expect(res.status).toBe(200);
    const game = (await container.games.get(gameId))!;
    expect(game.memberships.find((m) => m.userId === 'uA')!.sharingConsent).toBe(true);
  });

  it('refuses a share card while anyone depicted has not consented', async () => {
    const { gameId, code } = (await call(container, 'POST', '/games', { config: FREE_CONFIG }, 'host')).data;
    await call(container, 'POST', '/games/join', { code, displayName: 'A', action: { type: 'create_team', name: 'A' } }, 'uA');
    await call(container, 'POST', '/games/join', { code, displayName: 'B', action: { type: 'create_team', name: 'B' } }, 'uB');
    await call(container, 'POST', `/games/${gameId}/start`, {}, 'host');

    const teams = (await call(container, 'GET', `/games/${gameId}/teams`, undefined, 'host')).data as Array<{
      teamId: string;
      name: string;
    }>;
    const teamOf = (name: string) => teams.find((t) => t.name === name)!.teamId;
    const a = await call(container, 'POST', `/games/${gameId}/photos`, { teamId: teamOf('A'), location: { lat: 40, lng: -74 }, s3Key: 'a0' }, 'uA');
    const b = await call(container, 'POST', `/games/${gameId}/photos`, { teamId: teamOf('B'), location: { lat: 41, lng: -75 }, s3Key: 'b0' }, 'uB');
    const body = { originalPhotoId: a.data.photoId, chasePhotoId: b.data.photoId, scoreStamp: 'Best match!' };

    // uB has not answered, so the card must not be produced.
    await call(container, 'POST', `/games/${gameId}/consent`, { consent: true }, 'uA');
    expect((await call(container, 'POST', `/games/${gameId}/share-cards`, body, 'uA')).status).toBe(400);

    await call(container, 'POST', `/games/${gameId}/consent`, { consent: true }, 'uB');
    const card = await call(container, 'POST', `/games/${gameId}/share-cards`, body, 'uA');
    expect(card.status).toBe(200);
    expect(card.data.shareUrl).toContain('ref=');
  });

  it('creates a league for a paid host and serves its table by code', async () => {
    await container.entitlements.save({ userId: 'owner', tier: 'unlimited', gameCredits: 0, subscriptionActive: true });

    const created = await call(container, 'POST', '/tournaments', { name: 'Summer League' }, 'owner');
    expect(created.status).toBe(200);

    // Anyone can read the table — playing in someone else's league is free.
    const table = await call(container, 'GET', `/tournaments/${created.data.code}/standings`, undefined, 'guest');
    expect(table.status).toBe(200);
    expect(table.data.name).toBe('Summer League');
    expect(table.data.standings).toEqual([]);
  });

  it('refuses league creation on a free plan, and never from the body’s owner', async () => {
    expect((await call(container, 'POST', '/tournaments', { name: 'League' }, 'freeloader')).status).toBe(400);

    // A free user cannot pass someone else's id to borrow their plan.
    await container.entitlements.save({ userId: 'owner', tier: 'unlimited', gameCredits: 0, subscriptionActive: true });
    const spoof = await call(container, 'POST', '/tournaments', { name: 'League', ownerUserId: 'owner' }, 'freeloader');
    expect(spoof.status).toBe(400);
  });

  it('records a finished league game into its table on the results transition', async () => {
    await container.entitlements.save({ userId: 'owner', tier: 'unlimited', gameCredits: 0, subscriptionActive: true });
    const { code: leagueCode } = (await call(container, 'POST', '/tournaments', { name: 'League' }, 'owner')).data;

    const created = await call(container, 'POST', '/games', { config: FREE_CONFIG, tournamentCode: leagueCode }, 'owner');
    const { gameId, code } = created.data;
    await call(container, 'POST', '/games/join', { code, displayName: 'A', action: { type: 'create_team', name: 'Reds' } }, 'uA');
    await call(container, 'POST', '/games/join', { code, displayName: 'B', action: { type: 'create_team', name: 'Blues' } }, 'uB');
    await call(container, 'POST', `/games/${gameId}/start`, {}, 'owner');

    for (const event of ['END_ROUND1', 'COMPLETE_RETURN1', 'END_ROUND2', 'COMPLETE_RETURN2', 'COMPLETE_RATING', 'COMPLETE_FINALS']) {
      expect((await call(container, 'POST', `/games/${gameId}/advance`, { event }, 'owner')).status).toBe(200);
    }

    const table = await call(container, 'GET', `/tournaments/${leagueCode}/standings`, undefined, 'uA');
    expect(table.data.gamesPlayed).toBe(1);
    expect(table.data.standings.map((s: { teamKey: string }) => s.teamKey).sort()).toEqual(['blues', 'reds']);
  });

  it('refuses to attach a game to a league that does not exist', async () => {
    const res = await call(container, 'POST', '/games', { config: FREE_CONFIG, tournamentCode: 'NOSUCH' }, 'host');
    expect(res.status).toBe(400);
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

  it('serves the spectator view without authentication', async () => {
    const { code } = (await call(container, 'POST', '/games', { config: FREE_CONFIG }, 'host')).data;
    await call(container, 'POST', '/games/join', { code, displayName: 'A', action: { type: 'create_team', name: 'Reds' } }, 'uA');

    // No userId — a TV browser has nobody signed in.
    const res = await call(container, 'GET', `/spectate/${code}`);
    expect(res.status).toBe(200);
    expect(res.data.game.state).toBe('lobby');
    expect(res.data.game.teams).toHaveLength(1);
    expect(res.data.scoreboard).toBeNull();
  });

  it('returns an error for an unknown spectator code', async () => {
    expect((await call(container, 'GET', '/spectate/ZZZZZZ')).status).toBe(400);
  });

  it('serves the caller their own entitlement', async () => {
    const res = await call(container, 'GET', '/me/entitlement', undefined, 'someone');
    expect(res.status).toBe(200);
    expect(res.data.tier).toBe('free');
    expect(res.data.limits.maxTeams).toBe(2);
    expect(res.data.features.ai_judging).toBe(false);
  });

  it('requires authentication for the entitlement endpoint', async () => {
    expect((await call(container, 'GET', '/me/entitlement')).status).toBe(401);
  });

  describe('purchase webhook', () => {
    const SECRET = 'whsec_test';
    const GRANT = { userId: 'u', event: { type: 'game_pack_purchased', credits: 2 } };

    /** A container whose webhook verifier expects the shared secret. */
    const signedContainer = () => buildContainer({ PURCHASE_WEBHOOK_SECRET: SECRET } as NodeJS.ProcessEnv);

    /** Post to the webhook with explicit headers and no user identity. */
    async function postWebhook(c: Container, headers: Record<string, string>, body: unknown = GRANT) {
      const base = event('POST', '/webhooks/purchase', body);
      const res = await route({ ...base, headers } as APIGatewayProxyEventV2, c);
      return { status: res.statusCode, data: JSON.parse((res.body as string) ?? '{}') };
    }

    it('applies the event when the shared secret is correct', async () => {
      const res = await postWebhook(signedContainer(), { authorization: `Bearer ${SECRET}` });
      expect(res.status).toBe(200);
      expect(res.data.tier).toBe('game_pack');
    });

    it('rejects an unsigned request', async () => {
      const res = await postWebhook(signedContainer(), {});
      expect(res.status).toBe(401);
    });

    it('rejects a wrong secret', async () => {
      const res = await postWebhook(signedContainer(), { authorization: 'Bearer not-the-secret' });
      expect(res.status).toBe(401);
    });

    it('rejects everything when no secret is configured, rather than accepting', async () => {
      // This is the regression that mattered: an unconfigured deployment used
      // to grant entitlements to anyone who could reach the URL.
      const res = await postWebhook(container, { authorization: 'Bearer anything' });
      expect(res.status).toBe(401);
    });
  });
});
