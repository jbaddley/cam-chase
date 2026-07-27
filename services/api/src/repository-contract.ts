import type { Game } from '@photochase/shared';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { GameRepository } from './repository.js';

/** Build a fully-populated game aggregate with unique ids for contract tests. */
export function makeFullGame(overrides: Partial<Game> = {}): Game {
  const id = `game_${randomUUID()}`;
  const code = randomUUID().slice(0, 6).toUpperCase();
  return {
    id,
    hostUserId: 'host',
    code,
    tier: 'game_pack',
    config: {
      mode: 'photo_chase',
      photosPerRound: 8,
      round1Minutes: 15,
      round2Minutes: 15,
      maxTeams: 4,
      gameType: 'round_robin',
      judgeWeight: 2,
      specialCategories: { presets: ['craziest_pose'], custom: ['Best Hat'] },
      geofencing: true,
      aiJudging: true,
    },
    state: 'rating',
    teams: [
      { id: 'A', gameId: id, name: 'Reds', createdAt: 1 },
      { id: 'B', gameId: id, name: 'Blues', createdAt: 2 },
    ],
    memberships: [
      { id: 'mA', gameId: id, userId: 'uA', teamId: 'A', role: 'captain', returnCheckins: { round1: 111 } },
      { id: 'mJ', gameId: id, userId: 'uJ', teamId: null, role: 'judge', returnCheckins: {} },
    ],
    photos: [
      { id: 'oB', gameId: id, teamId: 'B', shooterUserId: 'uB', order: 0, location: { lat: 40, lng: -74, accuracyM: 5 }, capturedAt: 10, s3Key: 'oB.jpg', fouls: ['missing_clue'] },
      { id: 'cA', gameId: id, teamId: 'A', shooterUserId: 'uA', order: 0, location: { lat: 40, lng: -74 }, capturedAt: 20, s3Key: 'cA.jpg', fouls: [] },
    ],
    assignments: [
      { id: 'a1', gameId: id, chaserTeamId: 'A', originalPhotoId: 'oB', order: 0, chasePhotoId: 'cA' },
    ],
    votes: [{ id: 'v1', gameId: id, assignmentId: 'a1', voterUserId: 'uJ', axis: 'pose', stars: 4 }],
    createdAt: 0,
    ...overrides,
  };
}

/**
 * Behavioral contract every GameRepository implementation must satisfy. Run it
 * against each implementation (in-memory, DynamoDB) to prove interchangeability.
 * `makeRepo` returns a ready repository; tests use unique ids so a shared
 * backing store (e.g. one DynamoDB table) is safe.
 */
export function gameRepositoryContract(
  name: string,
  makeRepo: () => GameRepository | Promise<GameRepository>,
): void {
  describe(name, () => {
    it('returns null for an unknown id or code', async () => {
      const repo = await makeRepo();
      expect(await repo.get(`game_${randomUUID()}`)).toBeNull();
      expect(await repo.getByCode('ZZZZZZ')).toBeNull();
    });

    it('saves and reads back a full aggregate by id', async () => {
      const repo = await makeRepo();
      const game = makeFullGame();
      await repo.save(game);
      expect(await repo.get(game.id)).toEqual(game);
    });

    it('looks up a game by its join code', async () => {
      const repo = await makeRepo();
      const game = makeFullGame();
      await repo.save(game);
      expect(await repo.getByCode(game.code)).toEqual(game);
    });

    it('overwrites an existing game on save', async () => {
      const repo = await makeRepo();
      const game = makeFullGame({ state: 'lobby' });
      await repo.save(game);
      const advanced: Game = { ...game, state: 'round1_active' };
      await repo.save(advanced);
      expect((await repo.get(game.id))?.state).toBe('round1_active');
      // The code lookup still resolves to the same game.
      expect((await repo.getByCode(game.code))?.state).toBe('round1_active');
    });

    it('preserves nested structures (fouls, returnCheckins, null teamId)', async () => {
      const repo = await makeRepo();
      const game = makeFullGame();
      await repo.save(game);
      const loaded = (await repo.get(game.id))!;
      expect(loaded.photos.find((p) => p.id === 'oB')?.fouls).toEqual(['missing_clue']);
      expect(loaded.memberships.find((m) => m.id === 'mA')?.returnCheckins).toEqual({ round1: 111 });
      expect(loaded.memberships.find((m) => m.id === 'mJ')?.teamId).toBeNull();
    });
  });
}
