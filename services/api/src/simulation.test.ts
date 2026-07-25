import { DEFAULT_CONFIG, type Game, type GameConfig } from '@photochase/shared';
import { describe, expect, it } from 'vitest';
import {
  advanceGame,
  castFinalsVote,
  castVote,
  createGame,
  getResults,
  joinByCode,
  listAssignments,
  listRateable,
  startGame,
  submitChase,
  submitPhoto,
} from './handlers.js';
import { InMemoryGameRepository } from './repository.js';

/**
 * Full-game simulation gate (roadmap doc 09, Phase 1 exit criterion).
 *
 * Bot players drive a complete game through the real handlers — create, join,
 * Round 1 photos, generated assignments, chases, rating, finals, results — and
 * the final scoreboard is asserted exactly. Everything here is deterministic:
 * fixed team count, photo count, locations, and star ratings, so any drift in
 * assignment planning, scoring, or the state machine fails the build rather
 * than silently changing what players see.
 */

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.data;
}

const CONFIG: GameConfig = {
  ...DEFAULT_CONFIG,
  maxTeams: 3,
  photosPerRound: 5,
  judgeWeight: 3,
  specialCategories: { presets: [], custom: ['Craziest Pose'] },
};

/** Each team shoots at its own fixed spot, so location scoring is predictable. */
const TEAM_SPOTS = [
  { lat: 40.0, lng: -74.0 },
  { lat: 41.0, lng: -75.0 },
  { lat: 42.0, lng: -76.0 },
];

interface Bot {
  userId: string;
  teamId: string;
  name: string;
}

describe('full-game simulation', () => {
  it('plays a 3-team game end to end with an exact final scoreboard', async () => {
    const repo = new InMemoryGameRepository();

    // --- create + join -------------------------------------------------------
    const { gameId, code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: CONFIG }));

    const bots: Bot[] = [];
    for (let t = 0; t < 3; t++) {
      const name = `Team ${String.fromCharCode(65 + t)}`;
      const joined = await unwrap(
        joinByCode(repo, { code, userId: `u${t}`, displayName: name, action: { type: 'create_team', name } }),
      );
      bots.push({ userId: `u${t}`, teamId: joined.teamId!, name });
    }
    await unwrap(joinByCode(repo, { code, userId: 'judge', displayName: 'Judge', action: { type: 'judge' } }));

    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));

    // --- Round 1: every team shoots its quota at its own spot -----------------
    for (const [t, bot] of bots.entries()) {
      for (let i = 0; i < CONFIG.photosPerRound; i++) {
        await unwrap(
          submitPhoto(repo, {
            gameId,
            teamId: bot.teamId,
            shooterUserId: bot.userId,
            location: TEAM_SPOTS[t]!,
            s3Key: `${bot.userId}-photo-${i}`,
          }),
        );
      }
    }

    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));

    // --- Round 2: each team chases its queue, standing exactly on target ------
    const mid = (await repo.get(gameId)) as Game;
    expect(mid.state).toBe('round2_active');
    expect(mid.assignments).toHaveLength(3 * CONFIG.photosPerRound);

    for (const bot of bots) {
      const queue = await unwrap(listAssignments(repo, { gameId, userId: bot.userId }));
      expect(queue).toHaveLength(CONFIG.photosPerRound);
      for (const task of queue) {
        const original = mid.photos.find((p) => p.id === task.originalPhotoId)!;
        await unwrap(
          submitChase(repo, {
            gameId,
            assignmentId: task.assignmentId,
            location: original.location, // exact match → full location points
            s3Key: `${bot.userId}-chase-${task.assignmentId}`,
            shooterUserId: bot.userId,
          }),
        );
      }
    }

    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND2' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN2' }));

    // --- Rating: the judge gives every chase the same score -------------------
    const rateable = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    expect(rateable).toHaveLength(3 * CONFIG.photosPerRound); // judges rate everything
    for (const item of rateable) {
      await unwrap(castVote(repo, { gameId, assignmentId: item.assignmentId, voterUserId: 'judge', axis: 'pose', stars: 4 }));
      await unwrap(castVote(repo, { gameId, assignmentId: item.assignmentId, voterUserId: 'judge', axis: 'angle', stars: 4 }));
    }

    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RATING' }));

    // --- Finals: judge picks Team A overall, Team B for the custom category ---
    const [teamA, teamB] = bots;
    await unwrap(castFinalsVote(repo, { gameId, voterUserId: 'judge', category: 'best_overall_match', teamId: teamA!.teamId }));
    await unwrap(castFinalsVote(repo, { gameId, voterUserId: 'judge', category: 'Craziest Pose', teamId: teamB!.teamId }));

    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_FINALS' }));

    // --- Results -------------------------------------------------------------
    const { scoreboard } = await unwrap(getResults(repo, gameId));
    expect(scoreboard).toHaveLength(3);

    const byTeam = new Map(scoreboard.map((s) => [s.teamId, s]));
    const a = byTeam.get(teamA!.teamId)!;
    const b = byTeam.get(teamB!.teamId)!;
    const c = byTeam.get(bots[2]!.teamId)!;

    // Every chase was an exact location match: 100 points × 5 photos per team.
    for (const score of scoreboard) {
      expect(score.location).toBe(500);
      expect(score.foulPenalty).toBe(0);
    }

    // Identical 4-star ratings across every chase → identical pose/angle points.
    expect(new Set(scoreboard.map((s) => s.pose)).size).toBe(1);
    expect(new Set(scoreboard.map((s) => s.angle)).size).toBe(1);

    // Finals bonuses land exactly where the votes did.
    expect(a.bestMatchBonus).toBeGreaterThan(0);
    expect(a.specialBonus).toBe(0);
    expect(b.specialBonus).toBeGreaterThan(0);
    expect(b.bestMatchBonus).toBe(0);
    expect(c.bestMatchBonus).toBe(0);
    expect(c.specialBonus).toBe(0);

    // Totals are internally consistent and the overall winner is the vote winner.
    for (const s of scoreboard) {
      expect(s.total).toBe(
        s.location + s.pose + s.angle + s.timeBonus + s.bestMatchBonus + s.specialBonus - s.foulPenalty,
      );
    }
    expect(a.total).toBeGreaterThan(c.total);
    expect([...scoreboard].sort((x, y) => y.total - x.total)[0]!.teamId).toBe(teamA!.teamId);

    const finished = (await repo.get(gameId)) as Game;
    expect(finished.state).toBe('results');
  });
});
