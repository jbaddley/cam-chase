import { DEFAULT_CONFIG, ITEM_POINTS, WILDCARD_MULTIPLIER, type Game, type GameConfig } from '@photochase/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  advanceGame,
  castVote,
  createGame,
  flagFoul,
  getResults,
  joinByCode,
  listHuntItems,
  listRateable,
  startGame,
  submitPhoto,
} from './handlers.js';
import { InMemoryGameRepository } from './repository.js';

/**
 * Handler-level coverage for Scavenger Hunt. The hunt reuses the chase's
 * plumbing — Round 1, check-ins, fouls, finals — so what is tested here is only
 * what differs: the generated list, the withheld wildcard, item-scoped claims,
 * and validity judging.
 */

let repo: InMemoryGameRepository;
beforeEach(() => {
  repo = new InMemoryGameRepository();
});

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.data;
}

const HUNT_CONFIG: GameConfig = {
  ...DEFAULT_CONFIG,
  mode: 'scavenger_hunt',
  huntTheme: 'city',
  maxTeams: 2,
  photosPerRound: 5,
};

const SPOT = { lat: 40, lng: -74 };

/** A started hunt with two teams and a judge. */
async function huntInProgress(config: Partial<GameConfig> = {}) {
  const { gameId, code } = await unwrap(
    createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: { ...HUNT_CONFIG, ...config } }),
  );
  const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
  const b = await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
  await unwrap(joinByCode(repo, { code, userId: 'judge', displayName: 'J', action: { type: 'judge' } }));
  await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
  return { gameId, teamA: a.teamId!, teamB: b.teamId! };
}

/** Every item on the list, wildcard included — the server's own view. */
async function allItems(gameId: string) {
  return ((await repo.get(gameId)) as Game).hunt!.items;
}

describe('createGame — scavenger hunt', () => {
  it('generates a list of the configured size', async () => {
    const { gameId } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: HUNT_CONFIG }),
    );
    const game = (await repo.get(gameId)) as Game;
    // photosPerRound items, plus the wildcard held back for the mid-round drop.
    expect(game.hunt!.items).toHaveLength(HUNT_CONFIG.photosPerRound + 1);
    expect(game.hunt!.wildcardItemId).toBeTruthy();
  });

  it('does not stamp a reveal time before the round starts', async () => {
    const { gameId } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: HUNT_CONFIG }),
    );
    expect(((await repo.get(gameId)) as Game).hunt!.wildcardRevealAt).toBeUndefined();
  });

  it('gives a chase no hunt list at all', async () => {
    const { gameId } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: DEFAULT_CONFIG }),
    );
    expect(((await repo.get(gameId)) as Game).hunt).toBeUndefined();
  });
});

describe('listHuntItems', () => {
  it('withholds the wildcard until its reveal time, then shows it', async () => {
    const { gameId } = await huntInProgress();
    const revealAt = ((await repo.get(gameId)) as Game).hunt!.wildcardRevealAt!;

    const before = await unwrap(listHuntItems(repo, { gameId, userId: 'uA' }, () => revealAt - 1));
    expect(before.items).toHaveLength(HUNT_CONFIG.photosPerRound);
    expect(before.items.some((i) => i.wildcard)).toBe(false);
    // The countdown is public even though the item is not — that is the tension.
    expect(before.wildcardRevealAt).toBe(revealAt);

    const after = await unwrap(listHuntItems(repo, { gameId, userId: 'uA' }, () => revealAt));
    expect(after.items.filter((i) => i.wildcard)).toHaveLength(1);
  });

  it('marks only the caller’s own team’s claims', async () => {
    const { gameId, teamA, teamB } = await huntInProgress();
    const [item] = await allItems(gameId);
    await unwrap(submitPhoto(repo, { gameId, teamId: teamA, shooterUserId: 'uA', location: SPOT, s3Key: 'a', itemId: item!.id }));

    const forA = await unwrap(listHuntItems(repo, { gameId, userId: 'uA' }));
    const forB = await unwrap(listHuntItems(repo, { gameId, userId: 'uB' }));
    expect(forA.items.find((i) => i.itemId === item!.id)!.claimedPhotoId).toBeTruthy();
    expect(forB.items.find((i) => i.itemId === item!.id)!.claimedPhotoId).toBeNull();
    expect(teamB).toBeTruthy();
  });

  it('refuses a game that is not a hunt', async () => {
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: DEFAULT_CONFIG }),
    );
    await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    const result = await listHuntItems(repo, { gameId, userId: 'uA' });
    expect(result.ok).toBe(false);
  });

  it('refuses someone who is not in the game', async () => {
    const { gameId } = await huntInProgress();
    expect((await listHuntItems(repo, { gameId, userId: 'stranger' })).ok).toBe(false);
  });
});

describe('submitPhoto — scavenger hunt', () => {
  it('requires the photo to name the item it claims', async () => {
    const { gameId, teamA } = await huntInProgress();
    const result = await submitPhoto(repo, { gameId, teamId: teamA, shooterUserId: 'uA', location: SPOT, s3Key: 'a' });
    expect(result.ok).toBe(false);
  });

  it('rejects an item that is not on this hunt', async () => {
    const { gameId, teamA } = await huntInProgress();
    const result = await submitPhoto(repo, {
      gameId, teamId: teamA, shooterUserId: 'uA', location: SPOT, s3Key: 'a', itemId: 'not_a_real_item',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects the wildcard before it is revealed, even if its id is guessed', async () => {
    const { gameId, teamA } = await huntInProgress();
    const game = (await repo.get(gameId)) as Game;
    const wildcardId = game.hunt!.wildcardItemId!;
    const revealAt = game.hunt!.wildcardRevealAt!;

    const early = await submitPhoto(
      repo,
      { gameId, teamId: teamA, shooterUserId: 'uA', location: SPOT, s3Key: 'a', itemId: wildcardId },
      () => revealAt - 1,
    );
    expect(early.ok).toBe(false);

    const late = await submitPhoto(
      repo,
      { gameId, teamId: teamA, shooterUserId: 'uA', location: SPOT, s3Key: 'a', itemId: wildcardId },
      () => revealAt,
    );
    expect(late.ok).toBe(true);
  });

  it('records the claimed item on the photo', async () => {
    const { gameId, teamA } = await huntInProgress();
    const [item] = await allItems(gameId);
    const { photoId } = await unwrap(
      submitPhoto(repo, { gameId, teamId: teamA, shooterUserId: 'uA', location: SPOT, s3Key: 'a', itemId: item!.id }),
    );
    const game = (await repo.get(gameId)) as Game;
    expect(game.photos.find((p) => p.id === photoId)!.itemId).toBe(item!.id);
  });

  it('lets a team claim every item on the list, wildcard included', async () => {
    const { gameId, teamA } = await huntInProgress();
    const items = await allItems(gameId);
    const revealAt = ((await repo.get(gameId)) as Game).hunt!.wildcardRevealAt!;
    for (const item of items) {
      await unwrap(
        submitPhoto(
          repo,
          { gameId, teamId: teamA, shooterUserId: 'uA', location: SPOT, s3Key: item.id, itemId: item.id },
          () => revealAt,
        ),
      );
    }
    // The quota is the list, not photosPerRound — one more would be over.
    const extra = await submitPhoto(
      repo,
      { gameId, teamId: teamA, shooterUserId: 'uA', location: SPOT, s3Key: 'x', itemId: items[0]!.id },
      () => revealAt,
    );
    expect(extra.ok).toBe(false);
  });
});

describe('rating a hunt', () => {
  /** Both teams claim the same first item, then the game reaches rating. */
  async function huntInRating() {
    const started = await huntInProgress();
    const items = await allItems(started.gameId);
    const item = items[0]!;
    for (const [teamId, userId] of [[started.teamA, 'uA'], [started.teamB, 'uB']] as const) {
      await unwrap(
        submitPhoto(repo, { gameId: started.gameId, teamId, shooterUserId: userId, location: SPOT, s3Key: `${userId}-1`, itemId: item.id }),
      );
    }
    await unwrap(advanceGame(repo, { gameId: started.gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    await unwrap(advanceGame(repo, { gameId: started.gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));
    return { ...started, item };
  }

  it('queues claims by the item they name, not by assignment', async () => {
    const { gameId, item } = await huntInRating();
    const queue = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    expect(queue).toHaveLength(2);
    expect(queue[0]!.itemId).toBe(item.id);
    expect(queue[0]!.itemLabel).toBe(item.label);
  });

  it('never shows a player their own team’s claim', async () => {
    const { gameId, teamA } = await huntInRating();
    const queue = await unwrap(listRateable(repo, { gameId, userId: 'uA' }));
    expect(queue).toHaveLength(1);
    const game = (await repo.get(gameId)) as Game;
    expect(game.photos.find((p) => p.id === queue[0]!.chasePhotoId)!.teamId).not.toBe(teamA);
  });

  it('takes a validity vote and reports it back', async () => {
    const { gameId } = await huntInRating();
    const [claim] = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    await unwrap(castVote(repo, { gameId, assignmentId: claim!.assignmentId, voterUserId: 'judge', axis: 'validity', stars: 4 }));

    const after = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    expect(after.find((r) => r.assignmentId === claim!.assignmentId)!.myVotes.validity).toBe(4);
  });

  it('refuses pose and angle, which a hunt never scores', async () => {
    const { gameId } = await huntInRating();
    const [claim] = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    const result = await castVote(repo, { gameId, assignmentId: claim!.assignmentId, voterUserId: 'judge', axis: 'pose', stars: 5 });
    expect(result.ok).toBe(false);
  });

  it('refuses a player rating their own team’s find', async () => {
    const { gameId, teamA } = await huntInRating();
    const game = (await repo.get(gameId)) as Game;
    const own = game.photos.find((p) => p.teamId === teamA)!;
    const result = await castVote(repo, { gameId, assignmentId: own.id, voterUserId: 'uA', axis: 'validity', stars: 5 });
    expect(result.ok).toBe(false);
  });

  it('refuses validity on a chase, which has no items to validate', async () => {
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: { ...DEFAULT_CONFIG, maxTeams: 2, photosPerRound: 5 } }),
    );
    await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    const result = await castVote(repo, { gameId, assignmentId: 'anything', voterUserId: 'uA', axis: 'validity', stars: 5 });
    expect(result.ok).toBe(false);
  });
});

describe('getResults — scavenger hunt', () => {
  /** One claim per team, then straight to rating. */
  async function huntWithClaims(claims: Array<{ team: 'A' | 'B'; index: number }>) {
    const started = await huntInProgress();
    const items = await allItems(started.gameId);
    const revealAt = ((await repo.get(started.gameId)) as Game).hunt!.wildcardRevealAt!;
    for (const [n, claim] of claims.entries()) {
      const teamId = claim.team === 'A' ? started.teamA : started.teamB;
      await unwrap(
        submitPhoto(
          repo,
          {
            gameId: started.gameId,
            teamId,
            shooterUserId: `u${claim.team}`,
            location: SPOT,
            s3Key: `s${n}`,
            itemId: items[claim.index]!.id,
          },
          () => revealAt,
        ),
      );
    }
    await unwrap(advanceGame(repo, { gameId: started.gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    await unwrap(advanceGame(repo, { gameId: started.gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));
    return { ...started, items };
  }

  const scoreFor = (board: Awaited<ReturnType<typeof getResults>>, teamId: string) => {
    if (!board.ok) throw new Error(board.error);
    return board.data.scoreboard.find((s) => s.teamId === teamId)!;
  };

  it('pays an unjudged find, so a game with no judges still has a winner', async () => {
    const { gameId, teamA, items } = await huntWithClaims([{ team: 'A', index: 0 }]);
    const rarity = items[0]!.rarity;
    expect(scoreFor(await getResults(repo, gameId), teamA).location).toBe(ITEM_POINTS[rarity]);
  });

  it('voids a find the judges rated down', async () => {
    const { gameId, teamA } = await huntWithClaims([{ team: 'A', index: 0 }]);
    const [claim] = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    await unwrap(castVote(repo, { gameId, assignmentId: claim!.assignmentId, voterUserId: 'judge', axis: 'validity', stars: 1 }));
    expect(scoreFor(await getResults(repo, gameId), teamA).location).toBe(0);
  });

  it('voids a find flagged as missing its item, without also fining the team', async () => {
    const { gameId, teamA } = await huntWithClaims([{ team: 'A', index: 0 }]);
    const [claim] = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    await unwrap(flagFoul(repo, { gameId, photoId: claim!.originalPhotoId, userId: 'judge', reason: 'missing_item' }));

    const score = scoreFor(await getResults(repo, gameId), teamA);
    expect(score.location).toBe(0);
    // Losing the find is the penalty; charging a foul on top would be double.
    expect(score.foulPenalty).toBe(0);
  });

  it('still fines a team for an unrelated foul', async () => {
    const { gameId, teamA } = await huntWithClaims([{ team: 'A', index: 0 }]);
    const [claim] = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    await unwrap(flagFoul(repo, { gameId, photoId: claim!.originalPhotoId, userId: 'judge', reason: 'missing_face' }));

    const score = scoreFor(await getResults(repo, gameId), teamA);
    expect(score.foulPenalty).toBeGreaterThan(0);
    expect(score.location).toBeGreaterThan(0);
  });

  it('doubles the wildcard', async () => {
    const started = await huntInProgress();
    const game = (await repo.get(started.gameId)) as Game;
    const wildcard = game.hunt!.items.find((i) => i.id === game.hunt!.wildcardItemId)!;
    const revealAt = game.hunt!.wildcardRevealAt!;
    await unwrap(
      submitPhoto(
        repo,
        { gameId: started.gameId, teamId: started.teamA, shooterUserId: 'uA', location: SPOT, s3Key: 'w', itemId: wildcard.id },
        () => revealAt,
      ),
    );
    await unwrap(advanceGame(repo, { gameId: started.gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    await unwrap(advanceGame(repo, { gameId: started.gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));

    const score = scoreFor(await getResults(repo, started.gameId), started.teamA);
    expect(score.location).toBe(ITEM_POINTS[wildcard.rarity] * WILDCARD_MULTIPLIER);
  });

  it('never awards pose or angle points, which a hunt does not score', async () => {
    const { gameId, teamA } = await huntWithClaims([{ team: 'A', index: 0 }]);
    const score = scoreFor(await getResults(repo, gameId), teamA);
    expect(score.pose).toBe(0);
    expect(score.angle).toBe(0);
  });
});
