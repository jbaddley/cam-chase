import { DEFAULT_CONFIG, FREE_CONFIG, type Game } from '@photochase/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  abandonGame,
  createGameForHost,
  handlePurchaseWebhook,
  startGameForHost,
} from './billing-handlers.js';
import { joinByCode } from './handlers.js';
import { InMemoryEntitlementRepository } from './entitlements-repo.js';
import { InMemoryGameRepository } from './repository.js';

let games: InMemoryGameRepository;
let ents: InMemoryEntitlementRepository;
beforeEach(() => {
  games = new InMemoryGameRepository();
  ents = new InMemoryEntitlementRepository();
});

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

describe('createGameForHost', () => {
  it('uses the free tier for a new host and rejects paid-only config', async () => {
    const paidConfig = { ...DEFAULT_CONFIG, aiJudging: true };
    const result = await createGameForHost(games, ents, { hostUserId: 'host', config: paidConfig });
    expect(result.ok).toBe(false); // free host can't enable AI judging
  });

  it('creates a game for a free host with a free config', async () => {
    const { gameId } = await unwrap(createGameForHost(games, ents, { hostUserId: 'host', config: FREE_CONFIG }));
    const game = (await games.get(gameId)) as Game;
    expect(game.tier).toBe('free');
  });

  it('lets an upgraded host use advanced config', async () => {
    await unwrap(handlePurchaseWebhook(ents, { userId: 'host', event: { type: 'subscription_started', expiresAt: 9_999_999 } }));
    const { gameId } = await unwrap(
      createGameForHost(games, ents, { hostUserId: 'host', config: { ...DEFAULT_CONFIG, aiJudging: true, maxTeams: 6 } }),
    );
    const game = (await games.get(gameId)) as Game;
    expect(game.tier).toBe('unlimited');
  });
});

describe('startGameForHost credit accounting', () => {
  async function seedTwoTeams(hostUserId: string) {
    const { gameId, code } = await unwrap(createGameForHost(games, ents, { hostUserId, config: FREE_CONFIG }));
    await unwrap(joinByCode(games, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    await unwrap(joinByCode(games, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    return gameId;
  }

  it('consumes a game credit for a game_pack host on start', async () => {
    await unwrap(handlePurchaseWebhook(ents, { userId: 'host', event: { type: 'game_pack_purchased', credits: 2 } }));
    // game_pack host, but play a valid 2-team free-style config for simplicity
    const { gameId, code } = await unwrap(
      createGameForHost(games, ents, { hostUserId: 'host', config: { ...DEFAULT_CONFIG, maxTeams: 2 } }),
    );
    await unwrap(joinByCode(games, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    await unwrap(joinByCode(games, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));

    await unwrap(startGameForHost(games, ents, { gameId, hostUserId: 'host' }));
    expect((await ents.getOrCreate('host')).gameCredits).toBe(1);
  });

  it('refunds the credit if start fails (too few teams)', async () => {
    await unwrap(handlePurchaseWebhook(ents, { userId: 'host', event: { type: 'game_pack_purchased', credits: 1 } }));
    const { gameId, code } = await unwrap(
      createGameForHost(games, ents, { hostUserId: 'host', config: { ...DEFAULT_CONFIG, maxTeams: 2 } }),
    );
    await unwrap(joinByCode(games, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    const result = await startGameForHost(games, ents, { gameId, hostUserId: 'host' });
    expect(result.ok).toBe(false);
    expect((await ents.getOrCreate('host')).gameCredits).toBe(1); // refunded
  });

  it('blocks a game_pack host with no credits', async () => {
    await ents.save({ userId: 'host', tier: 'game_pack', gameCredits: 0, subscriptionActive: false });
    const gameId = await seedTwoTeams('host');
    const result = await startGameForHost(games, ents, { gameId, hostUserId: 'host' });
    expect(result.ok).toBe(false);
  });

  it('free host starts unlimited games without consuming credits', async () => {
    const gameId = await seedTwoTeams('freehost');
    await unwrap(startGameForHost(games, ents, { gameId, hostUserId: 'freehost' }));
    expect((await ents.getOrCreate('freehost')).gameCredits).toBe(0);
  });
});

describe('abandonGame', () => {
  it('refunds a credit when abandoning a lobby', async () => {
    await ents.save({ userId: 'host', tier: 'game_pack', gameCredits: 1, subscriptionActive: false });
    const { gameId } = await unwrap(
      createGameForHost(games, ents, { hostUserId: 'host', config: { ...DEFAULT_CONFIG, maxTeams: 2 } }),
    );
    await unwrap(abandonGame(games, ents, { gameId, hostUserId: 'host' }));
    expect((await ents.getOrCreate('host')).gameCredits).toBe(2);
  });
});

describe('handlePurchaseWebhook', () => {
  it('drives the entitlement through a subscription lifecycle', async () => {
    let ent = await unwrap(handlePurchaseWebhook(ents, { userId: 'u', event: { type: 'subscription_started', expiresAt: 100 } }));
    expect(ent.tier).toBe('unlimited');
    ent = await unwrap(handlePurchaseWebhook(ents, { userId: 'u', event: { type: 'subscription_expired' } }));
    expect(ent.tier).toBe('free');
  });

  it('rejects a malformed webhook', async () => {
    const result = await handlePurchaseWebhook(ents, { userId: 'u', event: { type: 'nonsense' } });
    expect(result.ok).toBe(false);
  });
});
