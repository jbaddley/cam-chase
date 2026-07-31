import { DEFAULT_CONFIG, ITEM_POINTS, WILDCARD_MULTIPLIER, type Game, type GameConfig } from '@photochase/shared';
import { describe, expect, it } from 'vitest';
import {
  advanceGame,
  castFinalsVote,
  castVote,
  checkIn,
  createGame,
  getResults,
  joinByCode,
  listHuntItems,
  listRateable,
  startGame,
  submitPhoto,
} from './handlers.js';
import { InMemoryGameRepository } from './repository.js';
import { bringEveryoneBack } from './return-test-support.js';

/**
 * Full-game simulation gate for Scavenger Hunt, mirroring the chase simulation.
 *
 * Bots drive a complete hunt through the real handlers — create, join, claim
 * items, the mid-round wildcard drop, return check-ins, validity judging,
 * finals, results — and the final scoreboard is asserted exactly. Anything that
 * drifts in list generation, the reveal, or scoring fails the build rather than
 * quietly changing what players see.
 */

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.data;
}

const CONFIG: GameConfig = {
  ...DEFAULT_CONFIG,
  mode: 'scavenger_hunt',
  huntTheme: 'city',
  maxTeams: 3,
  photosPerRound: 6,
  judgeWeight: 3,
  specialCategories: { presets: ['silliest_pose'], custom: [] },
  geofencing: true,
  returnSpot: { lat: 40.0, lng: -74.0, radiusM: 200 },
};

const SPOT = { lat: 40.0, lng: -74.0 };

interface Bot {
  userId: string;
  teamId: string;
}

describe('full-hunt simulation', () => {
  it('plays a 3-team scavenger hunt end to end with an exact final scoreboard', async () => {
    const repo = new InMemoryGameRepository();

    // --- create + join -------------------------------------------------------
    const { gameId, code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: CONFIG }));

    const bots: Bot[] = [];
    for (let t = 0; t < 3; t++) {
      const name = `Team ${String.fromCharCode(65 + t)}`;
      const joined = await unwrap(
        joinByCode(repo, { code, userId: `u${t}`, displayName: name, action: { type: 'create_team', name } }),
      );
      bots.push({ userId: `u${t}`, teamId: joined.teamId! });
    }
    await unwrap(joinByCode(repo, { code, userId: 'judge', displayName: 'Judge', action: { type: 'judge' } }));

    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));

    const hunt = ((await repo.get(gameId)) as Game).hunt!;
    const revealAt = hunt.wildcardRevealAt!;
    const wildcard = hunt.items.find((i) => i.id === hunt.wildcardItemId)!;
    const listed = hunt.items.filter((i) => i.id !== wildcard.id);
    expect(listed).toHaveLength(CONFIG.photosPerRound);

    // Before the drop, everyone sees the same list and no wildcard.
    for (const bot of bots) {
      const view = await unwrap(listHuntItems(repo, { gameId, userId: bot.userId }, () => revealAt - 1));
      expect(view.items.map((i) => i.itemId)).toEqual(listed.map((i) => i.id));
    }

    // --- Round 1 -------------------------------------------------------------
    // Team A sweeps the list, Team B takes half, Team C takes one. A steady
    // gradient, so any change in per-item scoring shows up as a ranking change.
    const claimsPerTeam = [listed.length, Math.floor(listed.length / 2), 1];
    for (const [t, bot] of bots.entries()) {
      for (let i = 0; i < claimsPerTeam[t]!; i++) {
        await unwrap(
          submitPhoto(
            repo,
            { gameId, teamId: bot.teamId, shooterUserId: bot.userId, location: SPOT, s3Key: `${bot.userId}-${i}`, itemId: listed[i]!.id },
            () => revealAt - 1,
          ),
        );
      }
    }

    // The wildcard drops: only Team A is still out with time to spend on it.
    const revealedFor = await unwrap(listHuntItems(repo, { gameId, userId: bots[0]!.userId }, () => revealAt));
    expect(revealedFor.items.find((i) => i.itemId === wildcard.id)!.wildcard).toBe(true);
    await unwrap(
      submitPhoto(
        repo,
        { gameId, teamId: bots[0]!.teamId, shooterUserId: bots[0]!.userId, location: SPOT, s3Key: 'u0-wild', itemId: wildcard.id },
        () => revealAt,
      ),
    );

    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));

    // --- Return: a minute apart, so the time bonus is strictly ordered --------
    const round1StartedAt = ((await repo.get(gameId)) as Game).roundStartedAt!.round1!;
    for (const [t, bot] of bots.entries()) {
      await unwrap(
        checkIn(repo, { gameId, userId: bot.userId, location: SPOT }, () => round1StartedAt + (t + 1) * 60_000),
      );
    }

    // A hunt has no Round 2: the return check-in leads straight to judging.
    await bringEveryoneBack(repo, gameId, 'round1');
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));
    expect(((await repo.get(gameId)) as Game).state).toBe('rating');

    // --- Judging: every claim accepted except Team C's only find -------------
    const queue = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    const totalClaims = claimsPerTeam.reduce((a, b) => a + b, 0) + 1; // +1 wildcard
    expect(queue).toHaveLength(totalClaims);
    expect(queue.every((r) => r.itemId !== undefined)).toBe(true);

    const game = (await repo.get(gameId)) as Game;
    const teamOf = new Map(game.photos.map((p) => [p.id, p.teamId]));
    for (const claim of queue) {
      const stars = teamOf.get(claim.chasePhotoId) === bots[2]!.teamId ? 1 : 5;
      await unwrap(castVote(repo, { gameId, assignmentId: claim.assignmentId, voterUserId: 'judge', axis: 'validity', stars }));
    }

    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RATING' }));

    // --- Finals: overall to A, silliest pose to B ----------------------------
    await unwrap(castFinalsVote(repo, { gameId, voterUserId: 'judge', category: 'best_overall_match', teamId: bots[0]!.teamId }));
    await unwrap(castFinalsVote(repo, { gameId, voterUserId: 'judge', category: 'silliest_pose', teamId: bots[1]!.teamId }));

    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_FINALS' }));

    // --- Results -------------------------------------------------------------
    const { scoreboard } = await unwrap(getResults(repo, gameId));
    expect(scoreboard).toHaveLength(3);
    const byTeam = new Map(scoreboard.map((s) => [s.teamId, s]));
    const [a, b, c] = bots.map((bot) => byTeam.get(bot.teamId)!);

    /** What the list is worth for the first `n` items, by their real rarity. */
    const listValue = (n: number) =>
      listed.slice(0, n).reduce((sum, item) => sum + ITEM_POINTS[item.rarity], 0);

    expect(a!.location).toBe(listValue(claimsPerTeam[0]!) + ITEM_POINTS[wildcard.rarity] * WILDCARD_MULTIPLIER);
    expect(b!.location).toBe(listValue(claimsPerTeam[1]!));
    // Team C's one find was voted down, so it scores nothing for it — and is
    // not fined either: a rejected claim is a miss, not a foul.
    expect(c!.location).toBe(0);
    expect(c!.foulPenalty).toBe(0);

    // A hunt scores no pose or angle, whatever the chase scorer would do.
    for (const score of scoreboard) {
      expect(score.pose).toBe(0);
      expect(score.angle).toBe(0);
    }

    // Return order holds.
    expect(a!.timeBonus).toBeGreaterThan(b!.timeBonus);
    expect(b!.timeBonus).toBeGreaterThan(c!.timeBonus);

    // Finals bonuses land exactly where the votes did.
    expect(a!.bestMatchBonus).toBeGreaterThan(0);
    expect(a!.specialBonus).toBe(0);
    expect(b!.specialBonus).toBeGreaterThan(0);
    expect(b!.bestMatchBonus).toBe(0);
    expect(c!.bestMatchBonus).toBe(0);
    expect(c!.specialBonus).toBe(0);

    for (const s of scoreboard) {
      expect(s.total).toBe(
        s.location + s.pose + s.angle + s.timeBonus + s.bestMatchBonus + s.specialBonus - s.foulPenalty,
      );
    }
    expect([...scoreboard].sort((x, y) => y.total - x.total)[0]!.teamId).toBe(bots[0]!.teamId);

    expect(((await repo.get(gameId)) as Game).state).toBe('results');
  });

  it('refuses a Round 2 event, which a hunt has no such thing as', async () => {
    const repo = new InMemoryGameRepository();
    const { gameId, code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: CONFIG }));
    for (const t of [0, 1]) {
      await unwrap(
        joinByCode(repo, { code, userId: `u${t}`, displayName: `T${t}`, action: { type: 'create_team', name: `T${t}` } }),
      );
    }
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));

    const result = await advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND2' });
    expect(result.ok).toBe(false);
  });
});
