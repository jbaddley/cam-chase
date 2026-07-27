import { CATCH_POINTS, COUNTER_POINTS, DEFAULT_CONFIG, SURVIVAL_POINTS, type Game, type GameConfig } from '@photochase/shared';
import { describe, expect, it } from 'vitest';
import {
  advanceGame,
  answerCatchClaim,
  claimCatch,
  createGame,
  getResults,
  getTagBrief,
  joinByCode,
  startGame,
  submitPhoto,
} from './handlers.js';
import { InMemoryGameRepository } from './repository.js';

/**
 * Full-game simulation gate for Photo Tag, one per sub-mode.
 *
 * **Scope of what this proves.** Bots drive the real handlers through a
 * complete round and the final scoreboard is asserted exactly, so role
 * assignment, catch resolution and scoring cannot drift silently. It proves
 * nothing about how the mode *feels*: proximity thresholds, scatter length and
 * catch latency depend on real GPS on real phones and are unverifiable here.
 */

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.data;
}

const SPOT = { lat: 40, lng: -74 };

interface Player {
  userId: string;
  teamId: string;
  name: string;
}

/** Individuals play as teams of one, so scoring and standings work unchanged. */
async function play(config: Partial<GameConfig>, playerCount = 4) {
  const repo = new InMemoryGameRepository();
  const { gameId, code } = await unwrap(
    createGame(repo, {
      hostUserId: 'host',
      tier: 'unlimited',
      config: { ...DEFAULT_CONFIG, mode: 'photo_tag', maxTeams: 6, ...config },
    }),
  );

  const players: Player[] = [];
  for (let i = 0; i < playerCount; i++) {
    const name = String.fromCharCode(65 + i);
    const joined = await unwrap(
      joinByCode(repo, {
        code,
        userId: `u${name}`,
        displayName: name,
        action: { type: 'create_team', name },
        acceptsBeingPhotographed: true,
      }),
    );
    players.push({ userId: `u${name}`, teamId: joined.teamId!, name });
  }

  await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
  return { repo, gameId, players };
}

/** Shoot, claim, and have the target confirm — a complete catch. */
async function catchPlayer(
  repo: InMemoryGameRepository,
  gameId: string,
  hunter: Player,
  target: Player,
): Promise<void> {
  const { photoId } = await unwrap(
    submitPhoto(repo, {
      gameId,
      teamId: hunter.teamId,
      shooterUserId: hunter.userId,
      location: SPOT,
      s3Key: `${hunter.userId}-${target.userId}`,
    }),
  );
  const { catchId } = await unwrap(
    claimCatch(repo, { gameId, hunterUserId: hunter.userId, targetTeamId: target.teamId, photoId }),
  );
  await unwrap(answerCatchClaim(repo, { gameId, userId: target.userId, catchId, confirm: true }));
}

async function finish(repo: InMemoryGameRepository, gameId: string) {
  await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_TAG' }));
  await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_FINALS' }));
  const { scoreboard } = await unwrap(getResults(repo, gameId));
  expect(((await repo.get(gameId)) as Game).state).toBe('results');
  return new Map(scoreboard.map((s) => [s.teamId, s]));
}

describe('full tag simulation — pure finder', () => {
  it('plays a round end to end with an exact final scoreboard', async () => {
    const { repo, gameId, players } = await play({ tagSubMode: 'pure_finder' });
    const [a, b, c, d] = players as [Player, Player, Player, Player];

    // Roles are withheld until the scatter window ends.
    for (const player of players) {
      expect((await unwrap(getTagBrief(repo, { gameId, userId: player.userId }))).role).toBeNull();
    }
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_SCATTER' }));

    // A catches two; B catches one; nobody catches C or D's hunter.
    await catchPlayer(repo, gameId, a, b);
    await catchPlayer(repo, gameId, a, c);
    await catchPlayer(repo, gameId, b, d);

    const board = await finish(repo, gameId);
    expect(board.get(a.teamId)!.location).toBe(2 * CATCH_POINTS);
    expect(board.get(b.teamId)!.location).toBe(CATCH_POINTS);
    expect(board.get(c.teamId)!.location).toBe(0);

    // Only A was never caught.
    expect(board.get(a.teamId)!.pose).toBe(SURVIVAL_POINTS);
    for (const caught of [b, c, d]) expect(board.get(caught.teamId)!.pose).toBe(0);

    for (const score of board.values()) {
      expect(score.angle).toBe(0);
      expect(score.timeBonus).toBe(0);
      expect(score.total).toBe(
        score.location + score.pose + score.angle + score.timeBonus + score.bestMatchBonus + score.specialBonus - score.foulPenalty,
      );
    }
    expect([...board.values()].sort((x, y) => y.total - x.total)[0]!.teamId).toBe(a.teamId);
  });
});

describe('full tag simulation — hide and seek', () => {
  it('lets a hider block the score by photographing their hunter first', async () => {
    const { repo, gameId, players } = await play({ tagSubMode: 'hide_seek' }, 6);
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_SCATTER' }));

    const roles = ((await repo.get(gameId)) as Game).tag!.roles!;
    const hunters = players.filter((p) => roles[p.teamId] === 'hunter');
    const hiders = players.filter((p) => roles[p.teamId] === 'hider');
    expect(hunters.length).toBeGreaterThanOrEqual(1);
    expect(hiders.length).toBeGreaterThan(hunters.length);

    const hunter = hunters[0]!;
    const [countering, caught] = hiders as [Player, Player, ...Player[]];

    // The countering hider gets their shot in first.
    await catchPlayer(repo, gameId, countering, hunter);
    await catchPlayer(repo, gameId, hunter, countering);
    // …and the other hider does not.
    await catchPlayer(repo, gameId, hunter, caught);

    const board = await finish(repo, gameId);
    // The counter blocked one catch, so only the second scored.
    expect(board.get(hunter.teamId)!.location).toBe(CATCH_POINTS);
    expect(board.get(countering.teamId)!.pose).toBeGreaterThanOrEqual(COUNTER_POINTS);
    expect(board.get(caught.teamId)!.location).toBe(0);
  });
});

describe('full tag simulation — dual', () => {
  it('pays only a catch of your own assigned prey', async () => {
    const { repo, gameId, players } = await play({ tagSubMode: 'dual' });
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_SCATTER' }));

    const targets = ((await repo.get(gameId)) as Game).tag!.targets!;
    const hunter = players[0]!;
    const myPrey = players.find((p) => p.teamId === targets[hunter.teamId])!;
    const notMine = players.find((p) => p.teamId !== hunter.teamId && p.teamId !== myPrey.teamId)!;

    await catchPlayer(repo, gameId, hunter, myPrey);
    await catchPlayer(repo, gameId, hunter, notMine);

    const board = await finish(repo, gameId);
    // The mode is your own chase, not opportunism.
    expect(board.get(hunter.teamId)!.location).toBe(CATCH_POINTS);
    // The unscored catch also leaves its subject counted as uncaught.
    expect(board.get(notMine.teamId)!.pose).toBe(SURVIVAL_POINTS);
    expect(board.get(myPrey.teamId)!.pose).toBe(0);
  });

  it('gives everyone exactly one prey and one hunter', async () => {
    const { repo, gameId, players } = await play({ tagSubMode: 'dual' }, 5);
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_SCATTER' }));

    const targets = ((await repo.get(gameId)) as Game).tag!.targets!;
    expect(Object.keys(targets)).toHaveLength(players.length);
    expect(new Set(Object.values(targets)).size).toBe(players.length);
    for (const [hunter, prey] of Object.entries(targets)) expect(prey).not.toBe(hunter);
  });
});

describe('tag flow guards', () => {
  it('refuses a chase event, which a tag game has no such phase for', async () => {
    const { repo, gameId } = await play({ tagSubMode: 'pure_finder' }, 2);
    expect((await advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' })).ok).toBe(false);
  });

  it('refuses a photo before the round is live', async () => {
    const { repo, gameId, players } = await play({ tagSubMode: 'pure_finder' }, 2);
    const result = await submitPhoto(repo, {
      gameId,
      teamId: players[0]!.teamId,
      shooterUserId: players[0]!.userId,
      location: SPOT,
      s3Key: 'early',
    });
    expect(result.ok).toBe(false);
  });

  it('imposes no photo quota, since a catch happens when it happens', async () => {
    const { repo, gameId, players } = await play({ tagSubMode: 'pure_finder' }, 2);
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_SCATTER' }));

    for (let i = 0; i < DEFAULT_CONFIG.photosPerRound + 3; i++) {
      await unwrap(
        submitPhoto(repo, {
          gameId,
          teamId: players[0]!.teamId,
          shooterUserId: players[0]!.userId,
          location: SPOT,
          s3Key: `shot-${i}`,
        }),
      );
    }
    expect(((await repo.get(gameId)) as Game).photos).toHaveLength(DEFAULT_CONFIG.photosPerRound + 3);
  });
});
