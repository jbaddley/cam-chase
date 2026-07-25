import { DEFAULT_CONFIG, FREE_CONFIG, type Game } from '@photochase/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  advanceGame,
  castFinalsVote,
  castVote,
  createGame,
  getFinals,
  getGameState,
  getResults,
  joinByCode,
  listAssignments,
  listRateable,
  listTeams,
  startGame,
  submitChase,
  submitPhoto,
} from './handlers.js';
import { InMemoryGameRepository } from './repository.js';

let repo: InMemoryGameRepository;
beforeEach(() => {
  repo = new InMemoryGameRepository();
});

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.data;
}

describe('createGame', () => {
  it('creates a game in the lobby with a join code', async () => {
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'free', config: FREE_CONFIG }),
    );
    expect(code).toHaveLength(6);
    const game = (await repo.get(gameId)) as Game;
    expect(game.state).toBe('lobby');
  });

  it('rejects a config that violates the tier', async () => {
    const result = await createGame(repo, {
      hostUserId: 'host',
      tier: 'free',
      config: { ...FREE_CONFIG, maxTeams: 4 },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects malformed input', async () => {
    const result = await createGame(repo, { hostUserId: '', tier: 'free', config: FREE_CONFIG });
    expect(result.ok).toBe(false);
  });
});

describe('create → join → start happy path', () => {
  it('lets two teams join and the host start', async () => {
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'free', config: FREE_CONFIG }),
    );
    await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'Team A' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'Team B' } }));

    const teams = await unwrap(listTeams(repo, gameId));
    expect(teams).toHaveLength(2);
    expect(teams.map((t) => t.name).sort()).toEqual(['Team A', 'Team B']);

    const started = await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
    expect(started.state).toBe('round1_active');
  });

  it('rejects joining a full game and an unknown code', async () => {
    const { code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'free', config: FREE_CONFIG }));
    await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    // Free tier caps at 2 teams.
    const third = await joinByCode(repo, { code, userId: 'uC', displayName: 'C', action: { type: 'create_team', name: 'C' } });
    expect(third.ok).toBe(false);
    const bad = await joinByCode(repo, { code: 'ZZZZZZ', userId: 'uX', displayName: 'X', action: { type: 'judge' } });
    expect(bad.ok).toBe(false);
  });

  it('rejects starting without enough teams and by a non-host', async () => {
    const { gameId, code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'free', config: FREE_CONFIG }));
    await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    expect((await startGame(repo, { gameId, hostUserId: 'host' })).ok).toBe(false);
    await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    expect((await startGame(repo, { gameId, hostUserId: 'intruder' })).ok).toBe(false);
  });
});

describe('full flow through the API reaches a scoreboard', () => {
  it('plays create → photos → assignments → chase → votes → results', async () => {
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'game_pack', config: { ...DEFAULT_CONFIG, maxTeams: 2, photosPerRound: 5 } }),
    );
    const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    const b = await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));

    const locA = { lat: 40, lng: -74 };
    const locB = { lat: 41, lng: -75 };
    for (let i = 0; i < 5; i++) {
      await unwrap(submitPhoto(repo, { gameId, teamId: a.teamId!, shooterUserId: 'uA', location: locA, s3Key: `a${i}` }));
      await unwrap(submitPhoto(repo, { gameId, teamId: b.teamId!, shooterUserId: 'uB', location: locB, s3Key: `b${i}` }));
    }

    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));

    let game = (await repo.get(gameId)) as Game;
    expect(game.state).toBe('round2_active');
    expect(game.assignments).toHaveLength(10); // 2 teams × 5 photos, round robin

    for (const asg of game.assignments) {
      const original = game.photos.find((p) => p.id === asg.originalPhotoId)!;
      await unwrap(
        submitChase(repo, { gameId, assignmentId: asg.id, location: original.location, s3Key: `chase-${asg.id}`, shooterUserId: 'chaser' }),
      );
    }

    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND2' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN2' }));

    game = (await repo.get(gameId)) as Game;
    expect(game.state).toBe('rating');
    for (const asg of game.assignments) {
      const voter = asg.chaserTeamId === a.teamId ? 'uB' : 'uA';
      await unwrap(castVote(repo, { gameId, assignmentId: asg.id, voterUserId: voter, axis: 'pose', stars: 5 }));
      await unwrap(castVote(repo, { gameId, assignmentId: asg.id, voterUserId: voter, axis: 'angle', stars: 4 }));
    }

    const { scoreboard } = await unwrap(getResults(repo, gameId));
    expect(scoreboard).toHaveLength(2);
    // Exact-match chases → 100 location points per chased photo (5 each).
    expect(scoreboard.every((s) => s.location === 500)).toBe(true);
    expect(scoreboard[0]!.total).toBeGreaterThanOrEqual(scoreboard[1]!.total);
  });

  it('rejects rating your own chase', async () => {
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'game_pack', config: { ...DEFAULT_CONFIG, maxTeams: 2, photosPerRound: 5 } }),
    );
    const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
    for (let i = 0; i < 5; i++) {
      await unwrap(submitPhoto(repo, { gameId, teamId: a.teamId!, shooterUserId: 'uA', location: { lat: 40, lng: -74 }, s3Key: `a${i}` }));
      const gb = (await repo.get(gameId)) as Game;
      const bTeam = gb.teams.find((t) => t.id !== a.teamId)!;
      await unwrap(submitPhoto(repo, { gameId, teamId: bTeam.id, shooterUserId: 'uB', location: { lat: 41, lng: -75 }, s3Key: `b${i}` }));
    }
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND2' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN2' }));
    const game = (await repo.get(gameId)) as Game;
    const ownChase = game.assignments.find((asg) => asg.chaserTeamId === a.teamId)!;
    const bad = await castVote(repo, { gameId, assignmentId: ownChase.id, voterUserId: 'uA', axis: 'pose', stars: 5 });
    expect(bad.ok).toBe(false);
  });
});

describe('listAssignments', () => {
  /** Play a 2-team game up to Round 2 so assignments exist. */
  async function gameInRound2() {
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'game_pack', config: { ...DEFAULT_CONFIG, maxTeams: 2, photosPerRound: 5 } }),
    );
    const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    const b = await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uJ', displayName: 'J', action: { type: 'judge' } }));
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
    for (let i = 0; i < 5; i++) {
      await unwrap(submitPhoto(repo, { gameId, teamId: a.teamId!, shooterUserId: 'uA', location: { lat: 40, lng: -74 }, s3Key: `a${i}` }));
      await unwrap(submitPhoto(repo, { gameId, teamId: b.teamId!, shooterUserId: 'uB', location: { lat: 41, lng: -75 }, s3Key: `b${i}` }));
    }
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));
    return { gameId, teamA: a.teamId!, teamB: b.teamId! };
  }

  it('returns only the caller team’s queue, in order, with the original key', async () => {
    const { gameId, teamA } = await gameInRound2();
    const mine = await unwrap(listAssignments(repo, { gameId, userId: 'uA' }));

    expect(mine).toHaveLength(5);
    expect(mine.map((m) => m.order)).toEqual([0, 1, 2, 3, 4]);
    // Round robin: team A chases team B's photos, never its own.
    expect(mine.every((m) => m.originalPhotoKey.startsWith('b'))).toBe(true);
    expect(mine.every((m) => m.chasePhotoId === null)).toBe(true);

    const game = (await repo.get(gameId)) as Game;
    const theirs = game.assignments.filter((asg) => asg.chaserTeamId !== teamA).map((asg) => asg.id);
    expect(mine.some((m) => theirs.includes(m.assignmentId))).toBe(false);
  });

  it('gives the other team a disjoint queue', async () => {
    const { gameId } = await gameInRound2();
    const forA = await unwrap(listAssignments(repo, { gameId, userId: 'uA' }));
    const forB = await unwrap(listAssignments(repo, { gameId, userId: 'uB' }));
    const idsA = new Set(forA.map((m) => m.assignmentId));
    expect(forB.some((m) => idsA.has(m.assignmentId))).toBe(false);
  });

  it('reflects a submitted chase', async () => {
    const { gameId } = await gameInRound2();
    const [first] = await unwrap(listAssignments(repo, { gameId, userId: 'uA' }));
    await unwrap(
      submitChase(repo, {
        gameId,
        assignmentId: first!.assignmentId,
        location: { lat: 41, lng: -75 },
        s3Key: 'chase-1',
        shooterUserId: 'uA',
      }),
    );
    const after = await unwrap(listAssignments(repo, { gameId, userId: 'uA' }));
    expect(after[0]!.chasePhotoId).not.toBeNull();
  });

  it('returns an empty queue for a judge and rejects a non-member', async () => {
    const { gameId } = await gameInRound2();
    expect(await unwrap(listAssignments(repo, { gameId, userId: 'uJ' }))).toEqual([]);
    expect((await listAssignments(repo, { gameId, userId: 'stranger' })).ok).toBe(false);
  });

  it('errors for an unknown game', async () => {
    expect((await listAssignments(repo, { gameId: 'nope', userId: 'uA' })).ok).toBe(false);
  });
});

describe('listRateable', () => {
  /** Play a 2-team game into the rating phase with every chase submitted. */
  async function gameInRating() {
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'game_pack', config: { ...DEFAULT_CONFIG, maxTeams: 2, photosPerRound: 5 } }),
    );
    const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    const b = await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uJ', displayName: 'J', action: { type: 'judge' } }));
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
    for (let i = 0; i < 5; i++) {
      await unwrap(submitPhoto(repo, { gameId, teamId: a.teamId!, shooterUserId: 'uA', location: { lat: 40, lng: -74 }, s3Key: `a${i}` }));
      await unwrap(submitPhoto(repo, { gameId, teamId: b.teamId!, shooterUserId: 'uB', location: { lat: 41, lng: -75 }, s3Key: `b${i}` }));
    }
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));
    const mid = (await repo.get(gameId)) as Game;
    for (const asg of mid.assignments) {
      await unwrap(
        submitChase(repo, { gameId, assignmentId: asg.id, location: { lat: 40, lng: -74 }, s3Key: `chase-${asg.id}`, shooterUserId: 'x' }),
      );
    }
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND2' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN2' }));
    return { gameId, teamA: a.teamId!, teamB: b.teamId! };
  }

  it('excludes the caller’s own team’s chases and pairs each with its original', async () => {
    const { gameId, teamA } = await gameInRating();
    const forA = await unwrap(listRateable(repo, { gameId, userId: 'uA' }));

    expect(forA).toHaveLength(5); // only team B's chases
    const game = (await repo.get(gameId)) as Game;
    const ownIds = game.assignments.filter((asg) => asg.chaserTeamId === teamA).map((asg) => asg.id);
    expect(forA.some((r) => ownIds.includes(r.assignmentId))).toBe(false);
    expect(forA.every((r) => r.chasePhotoKey.startsWith('chase-'))).toBe(true);
    expect(forA.every((r) => r.originalPhotoKey.length > 0)).toBe(true);
  });

  it('lets a judge rate every chase', async () => {
    const { gameId } = await gameInRating();
    expect(await unwrap(listRateable(repo, { gameId, userId: 'uJ' }))).toHaveLength(10);
  });

  it('reports the caller’s existing votes per axis', async () => {
    const { gameId } = await gameInRating();
    const [first] = await unwrap(listRateable(repo, { gameId, userId: 'uA' }));
    await unwrap(castVote(repo, { gameId, assignmentId: first!.assignmentId, voterUserId: 'uA', axis: 'pose', stars: 4 }));

    const after = await unwrap(listRateable(repo, { gameId, userId: 'uA' }));
    const rated = after.find((r) => r.assignmentId === first!.assignmentId)!;
    expect(rated.myVotes).toEqual({ pose: 4, angle: null });
  });

  it('omits assignments with no chase submitted', async () => {
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'game_pack', config: { ...DEFAULT_CONFIG, maxTeams: 2, photosPerRound: 5 } }),
    );
    const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    const b = await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
    for (let i = 0; i < 5; i++) {
      await unwrap(submitPhoto(repo, { gameId, teamId: a.teamId!, shooterUserId: 'uA', location: { lat: 40, lng: -74 }, s3Key: `a${i}` }));
      await unwrap(submitPhoto(repo, { gameId, teamId: b.teamId!, shooterUserId: 'uB', location: { lat: 41, lng: -75 }, s3Key: `b${i}` }));
    }
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));

    expect(await unwrap(listRateable(repo, { gameId, userId: 'uA' }))).toEqual([]);
  });

  it('rejects a non-member and an unknown game', async () => {
    const { gameId } = await gameInRating();
    expect((await listRateable(repo, { gameId, userId: 'stranger' })).ok).toBe(false);
    expect((await listRateable(repo, { gameId: 'nope', userId: 'uA' })).ok).toBe(false);
  });
});

describe('finals voting', () => {
  const CONFIG = {
    ...DEFAULT_CONFIG,
    maxTeams: 2,
    photosPerRound: 5,
    judgeWeight: 3,
    specialCategories: { presets: [], custom: ['Craziest Pose'] },
  };

  /** Play a 2-team game all the way into the finals_voting phase. */
  async function gameInFinals() {
    const { gameId, code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'game_pack', config: CONFIG }));
    const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    const b = await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uJ', displayName: 'J', action: { type: 'judge' } }));
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
    for (let i = 0; i < 5; i++) {
      await unwrap(submitPhoto(repo, { gameId, teamId: a.teamId!, shooterUserId: 'uA', location: { lat: 40, lng: -74 }, s3Key: `a${i}` }));
      await unwrap(submitPhoto(repo, { gameId, teamId: b.teamId!, shooterUserId: 'uB', location: { lat: 41, lng: -75 }, s3Key: `b${i}` }));
    }
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));
    const mid = (await repo.get(gameId)) as Game;
    for (const asg of mid.assignments) {
      const original = mid.photos.find((p) => p.id === asg.originalPhotoId)!;
      await unwrap(submitChase(repo, { gameId, assignmentId: asg.id, location: original.location, s3Key: `chase-${asg.id}`, shooterUserId: 'x' }));
    }
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND2' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN2' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RATING' }));
    return { gameId, teamA: a.teamId!, teamB: b.teamId! };
  }

  it('offers best-overall plus the configured custom categories', async () => {
    const { gameId } = await gameInFinals();
    const view = await unwrap(getFinals(repo, { gameId, userId: 'uA' }));
    expect(view.categories.map((c) => c.id)).toEqual(['best_overall_match', 'Craziest Pose']);
    expect(view.teams).toHaveLength(2);
    expect(view.myVotes).toEqual({});
  });

  it('records a vote and reports it back to the voter', async () => {
    const { gameId, teamB } = await gameInFinals();
    await unwrap(castFinalsVote(repo, { gameId, voterUserId: 'uA', category: 'best_overall_match', teamId: teamB }));
    const view = await unwrap(getFinals(repo, { gameId, userId: 'uA' }));
    expect(view.myVotes).toEqual({ best_overall_match: teamB });
  });

  it('replaces a previous vote in the same category rather than stacking', async () => {
    const { gameId, teamA, teamB } = await gameInFinals();
    await unwrap(castFinalsVote(repo, { gameId, voterUserId: 'uJ', category: 'best_overall_match', teamId: teamA }));
    await unwrap(castFinalsVote(repo, { gameId, voterUserId: 'uJ', category: 'best_overall_match', teamId: teamB }));

    const game = (await repo.get(gameId)) as Game;
    expect(game.finalsVotes).toHaveLength(1);
    expect(game.finalsVotes![0]!.teamId).toBe(teamB);
  });

  it('rejects voting for your own team, an unknown team, and an unknown category', async () => {
    const { gameId, teamA, teamB } = await gameInFinals();
    expect((await castFinalsVote(repo, { gameId, voterUserId: 'uA', category: 'best_overall_match', teamId: teamA })).ok).toBe(false);
    expect((await castFinalsVote(repo, { gameId, voterUserId: 'uA', category: 'best_overall_match', teamId: 'nope' })).ok).toBe(false);
    expect((await castFinalsVote(repo, { gameId, voterUserId: 'uA', category: 'Not A Category', teamId: teamB })).ok).toBe(false);
    expect((await castFinalsVote(repo, { gameId, voterUserId: 'stranger', category: 'best_overall_match', teamId: teamB })).ok).toBe(false);
  });

  it('lets the weighted judge vote outweigh a single player vote', async () => {
    const { gameId, teamA, teamB } = await gameInFinals();
    // Player uA picks B; the judge (weight 3) picks A — the judge should win.
    await unwrap(castFinalsVote(repo, { gameId, voterUserId: 'uA', category: 'best_overall_match', teamId: teamB }));
    await unwrap(castFinalsVote(repo, { gameId, voterUserId: 'uJ', category: 'best_overall_match', teamId: teamA }));

    const { scoreboard } = await unwrap(getResults(repo, gameId));
    const scoreA = scoreboard.find((s) => s.teamId === teamA)!;
    const scoreB = scoreboard.find((s) => s.teamId === teamB)!;
    expect(scoreA.bestMatchBonus).toBeGreaterThan(0);
    expect(scoreB.bestMatchBonus).toBe(0);
  });

  it('awards a special-category bonus to its winner', async () => {
    const { gameId, teamB } = await gameInFinals();
    await unwrap(castFinalsVote(repo, { gameId, voterUserId: 'uA', category: 'Craziest Pose', teamId: teamB }));

    const { scoreboard } = await unwrap(getResults(repo, gameId));
    expect(scoreboard.find((s) => s.teamId === teamB)!.specialBonus).toBeGreaterThan(0);
  });

  it('awards no finals bonuses when nobody voted', async () => {
    const { gameId } = await gameInFinals();
    const { scoreboard } = await unwrap(getResults(repo, gameId));
    expect(scoreboard.every((s) => s.bestMatchBonus === 0 && s.specialBonus === 0)).toBe(true);
  });

  it('rejects voting outside the finals phase', async () => {
    const { gameId, code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'game_pack', config: CONFIG }));
    const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    expect((await castFinalsVote(repo, { gameId, voterUserId: 'uB', category: 'best_overall_match', teamId: a.teamId! })).ok).toBe(false);
  });
});

describe('getGameState', () => {
  it('returns a sanitized view with teams, config, and counts', async () => {
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'free', config: FREE_CONFIG }),
    );
    await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'Team A' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'join_team', teamId: (await unwrap(listTeams(repo, gameId)))[0]!.teamId } }));
    await unwrap(joinByCode(repo, { code, userId: 'uJ', displayName: 'J', action: { type: 'judge' } }));

    const view = await unwrap(getGameState(repo, gameId));
    expect(view.id).toBe(gameId);
    expect(view.code).toBe(code);
    expect(view.state).toBe('lobby');
    expect(view.config).toEqual(FREE_CONFIG);
    expect(view.teams).toEqual([{ teamId: view.teams[0]!.teamId, name: 'Team A', memberCount: 2 }]);
    expect(view.playerCount).toBe(3);
  });

  it('does not leak raw memberships, photos, or votes', async () => {
    const { gameId } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'free', config: FREE_CONFIG }));
    const view = await unwrap(getGameState(repo, gameId));
    expect(view).not.toHaveProperty('memberships');
    expect(view).not.toHaveProperty('photos');
    expect(view).not.toHaveProperty('votes');
    expect(view).not.toHaveProperty('hostUserId');
  });

  it('errors for an unknown game', async () => {
    const result = await getGameState(repo, 'nope');
    expect(result.ok).toBe(false);
  });
});
