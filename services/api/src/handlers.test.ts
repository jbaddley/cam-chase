import { DEFAULT_CONFIG, FREE_CONFIG, type Game } from '@photochase/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  advanceGame,
  castFinalsVote,
  castVote,
  checkIn,
  clearFoul,
  createGame,
  flagFoul,
  getFinals,
  getGameState,
  getRegroup,
  getResults,
  getSpectatorView,
  joinByCode,
  leaveGame,
  listAssignments,
  listRateable,
  listTeams,
  setStartSpot,
  startGame,
  submitChase,
  submitPhoto,
} from './handlers.js';
import { bringEveryoneBack } from './return-test-support.js';
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
    await bringEveryoneBack(repo, gameId, 'round1');
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
    await bringEveryoneBack(repo, gameId, 'round2');
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
    await bringEveryoneBack(repo, gameId, 'round1');
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND2' }));
    await bringEveryoneBack(repo, gameId, 'round2');
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
    await bringEveryoneBack(repo, gameId, 'round1');
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
    await bringEveryoneBack(repo, gameId, 'round1');
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));
    const mid = (await repo.get(gameId)) as Game;
    for (const asg of mid.assignments) {
      await unwrap(
        submitChase(repo, { gameId, assignmentId: asg.id, location: { lat: 40, lng: -74 }, s3Key: `chase-${asg.id}`, shooterUserId: 'x' }),
      );
    }
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND2' }));
    await bringEveryoneBack(repo, gameId, 'round2');
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
    // `validity` is a scavenger axis and never scored in a chase.
    expect(rated.myVotes).toEqual({ pose: 4, angle: null, validity: null });
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
    await bringEveryoneBack(repo, gameId, 'round1');
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));

    expect(await unwrap(listRateable(repo, { gameId, userId: 'uA' }))).toEqual([]);
  });

  it('rejects a non-member and an unknown game', async () => {
    const { gameId } = await gameInRating();
    expect((await listRateable(repo, { gameId, userId: 'stranger' })).ok).toBe(false);
    expect((await listRateable(repo, { gameId: 'nope', userId: 'uA' })).ok).toBe(false);
  });
});

describe('fouls', () => {
  /** Play into the rating phase and hand back a photo owned by each team. */
  async function gameInRatingWithPhotos() {
    const config = { ...DEFAULT_CONFIG, maxTeams: 2, photosPerRound: 5 };
    const { gameId, code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'game_pack', config }));
    const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    const b = await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uJ', displayName: 'J', action: { type: 'judge' } }));
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
    for (let i = 0; i < 5; i++) {
      await unwrap(submitPhoto(repo, { gameId, teamId: a.teamId!, shooterUserId: 'uA', location: { lat: 40, lng: -74 }, s3Key: `a${i}` }));
      await unwrap(submitPhoto(repo, { gameId, teamId: b.teamId!, shooterUserId: 'uB', location: { lat: 41, lng: -75 }, s3Key: `b${i}` }));
    }
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    await bringEveryoneBack(repo, gameId, 'round1');
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));
    const mid = (await repo.get(gameId)) as Game;
    for (const asg of mid.assignments) {
      const original = mid.photos.find((p) => p.id === asg.originalPhotoId)!;
      await unwrap(submitChase(repo, { gameId, assignmentId: asg.id, location: original.location, s3Key: `chase-${asg.id}`, shooterUserId: 'x' }));
    }
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND2' }));
    await bringEveryoneBack(repo, gameId, 'round2');
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN2' }));

    const game = (await repo.get(gameId)) as Game;
    return {
      gameId,
      teamA: a.teamId!,
      teamB: b.teamId!,
      photoOfA: game.photos.find((p) => p.teamId === a.teamId)!.id,
      photoOfB: game.photos.find((p) => p.teamId === b.teamId)!.id,
    };
  }

  it('records a foul on another team’s photo', async () => {
    const { gameId, photoOfB } = await gameInRatingWithPhotos();
    const result = await unwrap(flagFoul(repo, { gameId, photoId: photoOfB, userId: 'uA', reason: 'missing_face' }));
    expect(result.fouls).toEqual(['missing_face']);
  });

  it('does not stack a repeated reason but does record a second distinct one', async () => {
    const { gameId, photoOfB } = await gameInRatingWithPhotos();
    await unwrap(flagFoul(repo, { gameId, photoId: photoOfB, userId: 'uA', reason: 'missing_face' }));
    const again = await unwrap(flagFoul(repo, { gameId, photoId: photoOfB, userId: 'uJ', reason: 'missing_face' }));
    expect(again.fouls).toEqual(['missing_face']);

    const both = await unwrap(flagFoul(repo, { gameId, photoId: photoOfB, userId: 'uA', reason: 'missing_clue' }));
    expect(both.fouls).toEqual(['missing_face', 'missing_clue']);
  });

  it('clears a wrongly-called foul', async () => {
    const { gameId, photoOfB } = await gameInRatingWithPhotos();
    await unwrap(flagFoul(repo, { gameId, photoId: photoOfB, userId: 'uA', reason: 'missing_face' }));
    const cleared = await unwrap(clearFoul(repo, { gameId, photoId: photoOfB, userId: 'uA', reason: 'missing_face' }));
    expect(cleared.fouls).toEqual([]);
  });

  it('lets a judge foul any team', async () => {
    const { gameId, photoOfA, photoOfB } = await gameInRatingWithPhotos();
    expect((await flagFoul(repo, { gameId, photoId: photoOfA, userId: 'uJ', reason: 'missing_clue' })).ok).toBe(true);
    expect((await flagFoul(repo, { gameId, photoId: photoOfB, userId: 'uJ', reason: 'missing_clue' })).ok).toBe(true);
  });

  it('rejects fouling your own team, an unknown photo, and an unknown reason', async () => {
    const { gameId, photoOfA, photoOfB } = await gameInRatingWithPhotos();
    expect((await flagFoul(repo, { gameId, photoId: photoOfA, userId: 'uA', reason: 'missing_face' })).ok).toBe(false);
    expect((await flagFoul(repo, { gameId, photoId: 'nope', userId: 'uA', reason: 'missing_face' })).ok).toBe(false);
    expect((await flagFoul(repo, { gameId, photoId: photoOfB, userId: 'uA', reason: 'made_up' })).ok).toBe(false);
    expect((await flagFoul(repo, { gameId, photoId: photoOfB, userId: 'stranger', reason: 'missing_face' })).ok).toBe(false);
  });

  it('rejects fouls outside the rating phase', async () => {
    const config = { ...DEFAULT_CONFIG, maxTeams: 2, photosPerRound: 5 };
    const { gameId, code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'game_pack', config }));
    const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
    await unwrap(submitPhoto(repo, { gameId, teamId: a.teamId!, shooterUserId: 'uA', location: { lat: 40, lng: -74 }, s3Key: 'a0' }));
    const game = (await repo.get(gameId)) as Game;
    expect((await flagFoul(repo, { gameId, photoId: game.photos[0]!.id, userId: 'uB', reason: 'missing_face' })).ok).toBe(false);
  });

  it('penalizes the fouled team on the scoreboard', async () => {
    const { gameId, teamA, teamB, photoOfB } = await gameInRatingWithPhotos();
    const before = await unwrap(getResults(repo, gameId));
    expect(before.scoreboard.every((s) => s.foulPenalty === 0)).toBe(true);

    await unwrap(flagFoul(repo, { gameId, photoId: photoOfB, userId: 'uA', reason: 'missing_face' }));
    await unwrap(flagFoul(repo, { gameId, photoId: photoOfB, userId: 'uA', reason: 'missing_clue' }));

    const { scoreboard } = await unwrap(getResults(repo, gameId));
    const scoreB = scoreboard.find((s) => s.teamId === teamB)!;
    const scoreA = scoreboard.find((s) => s.teamId === teamA)!;
    expect(scoreB.foulPenalty).toBeGreaterThan(0);
    expect(scoreA.foulPenalty).toBe(0);
    // The penalty subtracts from the fouled team's total.
    expect(scoreB.total).toBe(
      scoreB.location + scoreB.pose + scoreB.angle + scoreB.timeBonus + scoreB.bestMatchBonus + scoreB.specialBonus - scoreB.foulPenalty,
    );
  });

  it('surfaces the current fouls on the rateable view', async () => {
    const { gameId, photoOfB } = await gameInRatingWithPhotos();
    await unwrap(flagFoul(repo, { gameId, photoId: photoOfB, userId: 'uA', reason: 'missing_face' }));

    // Read as the judge: a player's own rateable list never contains the
    // assignments their team chased, so it wouldn't include team B's original.
    const rateable = await unwrap(listRateable(repo, { gameId, userId: 'uJ' }));
    const fouled = rateable.find((r) => r.originalPhotoId === photoOfB);
    expect(fouled?.originalFouls).toEqual(['missing_face']);
    expect(rateable.filter((r) => r.originalPhotoId !== photoOfB).every((r) => r.originalFouls.length === 0)).toBe(true);
  });
});

describe('return check-in', () => {
  const SPOT = { lat: 40.0, lng: -74.0, radiusM: 100 };

  /** Play into round1_return, optionally with a return geofence configured. */
  async function gameReturning(returnSpot?: typeof SPOT) {
    const config = { ...DEFAULT_CONFIG, maxTeams: 2, photosPerRound: 5, ...(returnSpot ? { returnSpot } : {}) };
    const { gameId, code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'game_pack', config }));
    const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    const b = await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uJ', displayName: 'J', action: { type: 'judge' } }));
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
    for (let i = 0; i < 5; i++) {
      await unwrap(submitPhoto(repo, { gameId, teamId: a.teamId!, shooterUserId: 'uA', location: { lat: 40, lng: -74 }, s3Key: `a${i}` }));
      await unwrap(submitPhoto(repo, { gameId, teamId: b.teamId!, shooterUserId: 'uB', location: { lat: 41, lng: -75 }, s3Key: `b${i}` }));
    }
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    return { gameId, teamA: a.teamId!, teamB: b.teamId! };
  }

  it('records the check-in against the current round', async () => {
    const { gameId } = await gameReturning();
    const result = await unwrap(checkIn(repo, { gameId, userId: 'uA', location: SPOT }, () => 5_000));
    expect(result.round).toBe('round1');
    expect(result.at).toBe(5_000);

    const game = (await repo.get(gameId)) as Game;
    expect(game.memberships.find((m) => m.userId === 'uA')!.returnCheckins.round1).toBe(5_000);
  });

  it('keeps the earliest check-in when a member checks in twice', async () => {
    const { gameId } = await gameReturning();
    await unwrap(checkIn(repo, { gameId, userId: 'uA', location: SPOT }, () => 5_000));
    const second = await unwrap(checkIn(repo, { gameId, userId: 'uA', location: SPOT }, () => 9_000));
    expect(second.at).toBe(5_000);
  });

  it('rejects a check-in outside the return geofence', async () => {
    const { gameId } = await gameReturning(SPOT);
    const faraway = { lat: 41.5, lng: -75.5 };
    expect((await checkIn(repo, { gameId, userId: 'uA', location: faraway })).ok).toBe(false);
    // Just inside the fence is accepted.
    expect((await checkIn(repo, { gameId, userId: 'uA', location: { lat: 40.0005, lng: -74 } })).ok).toBe(true);
  });

  it('accepts a check-in anywhere when no return spot is configured', async () => {
    const { gameId } = await gameReturning();
    expect((await checkIn(repo, { gameId, userId: 'uA', location: { lat: 12, lng: 34 } })).ok).toBe(true);
  });

  it('rejects check-ins from judges and from non-members', async () => {
    const { gameId } = await gameReturning();
    expect((await checkIn(repo, { gameId, userId: 'uJ', location: SPOT })).ok).toBe(false); // judge, no team
    expect((await checkIn(repo, { gameId, userId: 'stranger', location: SPOT })).ok).toBe(false);
  });

  /**
   * This used to be the tail of the test above, asserting a check-in failed in
   * `round2_active` because that was not a return phase. It is one now — a team
   * that finishes its chases can head back while others are still out — so the
   * assertion survived only because the team happened to owe chases. Made
   * explicit, since that is the actual rule.
   */
  it('refuses a Round 2 check-in from a team that still owes chases', async () => {
    const { gameId } = await gameReturning();
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1', force: true }));

    const res = await checkIn(repo, { gameId, userId: 'uA', location: SPOT });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/before you check in/);
  });

  it('accepts a Round 1 check-in mid-round once the team has finished its photos', async () => {
    // The mixed roster depends on this: one team back and ready while another is
    // still out shooting, without waiting for the host to call time.
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'game_pack', config: { ...DEFAULT_CONFIG, maxTeams: 2, photosPerRound: 5 } }),
    );
    const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));

    // Four of five: still shooting, so not yet allowed back.
    for (let i = 0; i < 4; i++) {
      await unwrap(submitPhoto(repo, { gameId, teamId: a.teamId!, shooterUserId: 'uA', location: SPOT, s3Key: `a${i}` }));
    }
    expect((await checkIn(repo, { gameId, userId: 'uA', location: SPOT })).ok).toBe(false);

    await unwrap(submitPhoto(repo, { gameId, teamId: a.teamId!, shooterUserId: 'uA', location: SPOT, s3Key: 'a4' }));
    // Team B has not taken a single photo, and A being back does not depend on it.
    expect((await checkIn(repo, { gameId, userId: 'uA', location: SPOT })).ok).toBe(true);
  });

  it('lets a team called back mid-round check in with photos still owed', async () => {
    // The quota gate exists to stop everyone checking in at kickoff, where they
    // are all standing on the spot already. Once the host calls time it must
    // lift, or a team that stopped early is stranded.
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'game_pack', config: { ...DEFAULT_CONFIG, maxTeams: 2, photosPerRound: 5 } }),
    );
    await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));

    expect((await checkIn(repo, { gameId, userId: 'uA', location: SPOT })).ok).toBe(true);
  });

  it('gives the faster returning team the larger time bonus', async () => {
    const { gameId, teamA, teamB } = await gameReturning();
    const game = (await repo.get(gameId)) as Game;
    const startedAt = game.roundStartedAt!.round1!;

    // Team A returns a minute after the round started; team B, five minutes.
    await unwrap(checkIn(repo, { gameId, userId: 'uA', location: SPOT }, () => startedAt + 60_000));
    await unwrap(checkIn(repo, { gameId, userId: 'uB', location: SPOT }, () => startedAt + 300_000));

    // Both teams are back for Round 1, so the gate opens on its own here.
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND2' }));
    // Equal Round 2 legs, so the Round 1 gap is what decides the ranking.
    await bringEveryoneBack(repo, gameId, 'round2');
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN2' }));

    const { scoreboard } = await unwrap(getResults(repo, gameId));
    const scoreA = scoreboard.find((s) => s.teamId === teamA)!;
    const scoreB = scoreboard.find((s) => s.teamId === teamB)!;
    expect(scoreA.timeBonus).toBeGreaterThan(scoreB.timeBonus);
  });

  it('leaves timeBonus at zero when nobody checked in', async () => {
    const { gameId } = await gameReturning();
    // Forcing is the honest fixture here: the premise is that nobody came back,
    // which is exactly the case the host override exists for.
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1', force: true }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND2' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN2', force: true }));

    const { scoreboard } = await unwrap(getResults(repo, gameId));
    expect(scoreboard.every((s) => s.timeBonus === 0)).toBe(true);
  });

  it('reports who is back and who is still out', async () => {
    const { gameId, teamA, teamB } = await gameReturning();
    await unwrap(checkIn(repo, { gameId, userId: 'uA', location: SPOT }));

    const view = await unwrap(getRegroup(repo, { gameId, userId: 'uB' }));
    expect(view.round).toBe(1);
    expect(view.calledBack).toBe(true);
    expect(view.teams.find((t) => t.teamId === teamA)!.status).toBe('ready');
    // B has all five photos but has not checked in — the honest middle state.
    expect(view.teams.find((t) => t.teamId === teamB)!.status).toBe('heading_back');
    expect(view).toMatchObject({ readyCount: 1, teamCount: 2, allReady: false });
    expect(view.me).toMatchObject({ teamId: teamB, status: 'heading_back', done: 5, goal: 5 });
  });

  it('opens the gate once every team is in', async () => {
    const { gameId } = await gameReturning();
    await unwrap(checkIn(repo, { gameId, userId: 'uA', location: SPOT }));
    await unwrap(checkIn(repo, { gameId, userId: 'uB', location: SPOT }));

    const view = await unwrap(getRegroup(repo, { gameId, userId: 'uA' }));
    expect(view).toMatchObject({ allReady: true, readyCount: 2 });
  });

  it('gives a judge the roster but no team of their own', async () => {
    const { gameId } = await gameReturning();
    const view = await unwrap(getRegroup(repo, { gameId, userId: 'uJ' }));
    expect(view.teams).toHaveLength(2);
    expect(view.me).toBeNull();
  });

  /**
   * The reason this is its own endpoint rather than fields on `GameStateView`:
   * that view is what the unauthenticated `/spectate/:code` route serves, so
   * anything on it is public. Asserted on the serialized JSON, because a type
   * would not have stopped a coordinate being spread in.
   */
  it('never carries coordinates', async () => {
    const { gameId } = await gameReturning({ lat: 40, lng: -74, radiusM: 100 });
    const view = await unwrap(getRegroup(repo, { gameId, userId: 'uA' }));
    expect(view.fenced).toBe(true);

    const json = JSON.stringify(view);
    for (const leak of ['lat', 'lng', 'radiusM', 'startSpot', '-74']) {
      expect(json, `regroup view leaked ${leak}`).not.toContain(leak);
    }
  });

  it('says when a game has no fence at all', async () => {
    const { gameId } = await gameReturning();
    expect((await unwrap(getRegroup(repo, { gameId, userId: 'uA' }))).fenced).toBe(false);
  });

  it('refuses a non-member and a game outside a round', async () => {
    const { gameId } = await gameReturning();
    expect((await getRegroup(repo, { gameId, userId: 'stranger' })).ok).toBe(false);

    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1', force: true }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND2' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN2', force: true }));
    // Rating is not a round; there is nobody to be waiting for.
    expect((await getRegroup(repo, { gameId, userId: 'uA' })).ok).toBe(false);
  });

  it('records the host’s location at start and fences check-ins against it', async () => {
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'game_pack', config: { ...DEFAULT_CONFIG, maxTeams: 2, photosPerRound: 5 } }),
    );
    await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    // The host is standing with the teams, which is what the lobby tells them.
    await unwrap(startGame(repo, { gameId, hostUserId: 'host', location: { lat: 40, lng: -74 } }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));

    const far = await checkIn(repo, { gameId, userId: 'uA', location: { lat: 40.01, lng: -74 } });
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.error).toMatch(/m to go/);

    expect((await checkIn(repo, { gameId, userId: 'uA', location: { lat: 40, lng: -74 } })).ok).toBe(true);
  });

  it('starts unfenced when the host declines location', async () => {
    // An unstartable game is worse than an unenforced return.
    const { gameId } = await gameReturning();
    const game = (await repo.get(gameId)) as Game;
    expect(game.startSpot).toBeUndefined();
    expect((await checkIn(repo, { gameId, userId: 'uA', location: { lat: -33, lng: 151 } })).ok).toBe(true);
  });

  /**
   * The spot is recorded at Start, which assumes the host was standing at it.
   * When they were not — Start pressed in the car, or on a device that reports
   * somewhere else entirely — the fence measures from the wrong place and nobody
   * can ever check in. This is the way out.
   */
  describe('correcting the meeting spot', () => {
    it('moves the spot to where the host is now', async () => {
      const { gameId } = await gameReturning();
      await unwrap(setStartSpot(repo, { gameId, hostUserId: 'host', location: { lat: 40, lng: -74 } }));

      // Far from the new spot: refused.
      expect((await checkIn(repo, { gameId, userId: 'uA', location: { lat: 41, lng: -74 } })).ok).toBe(false);
      expect((await checkIn(repo, { gameId, userId: 'uA', location: { lat: 40, lng: -74 } })).ok).toBe(true);
    });

    it('drops the fence entirely when the host clears it', async () => {
      const { gameId } = await gameReturning();
      await unwrap(setStartSpot(repo, { gameId, hostUserId: 'host', location: { lat: 40, lng: -74 } }));
      expect((await checkIn(repo, { gameId, userId: 'uA', location: { lat: -33, lng: 151 } })).ok).toBe(false);

      // Clearing is the only escape when the host's own device is the thing in
      // the wrong place — re-recording from it stores the same wrong point.
      const res = await unwrap(setStartSpot(repo, { gameId, hostUserId: 'host', clear: true }));
      expect(res.fenced).toBe(false);
      expect((await checkIn(repo, { gameId, userId: 'uA', location: { lat: -33, lng: 151 } })).ok).toBe(true);
    });

    it('is host only', async () => {
      const { gameId } = await gameReturning();
      // Where a team checks in from is the one thing a player would most like to
      // decide for themselves.
      expect((await setStartSpot(repo, { gameId, hostUserId: 'uA', location: { lat: 1, lng: 2 } })).ok).toBe(false);
      expect((await setStartSpot(repo, { gameId, hostUserId: 'uA', clear: true })).ok).toBe(false);
    });

    it('rejects a spot that is not a position', async () => {
      const { gameId } = await gameReturning();
      expect((await setStartSpot(repo, { gameId, hostUserId: 'host', location: { lat: 'here' } })).ok).toBe(false);
      expect((await setStartSpot(repo, { gameId, hostUserId: 'host' })).ok).toBe(false);
    });

    it('reports a hopeless distance as a wrong spot, not a walk', async () => {
      const { gameId } = await gameReturning();
      // Googleplex, which is what an Android emulator reports, against a real
      // phone in Utah — the exact shape of the bug this came from.
      await unwrap(setStartSpot(repo, { gameId, hostUserId: 'host', location: { lat: 37.4219983, lng: -122.084 } }));

      const res = await checkIn(repo, { gameId, userId: 'uA', location: { lat: 40.379352, lng: -111.8741695 } });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        // Not "941950 m to go", which reads as a broken app and sends the player
        // nowhere. Kilometres, and it names who can fix it.
        expect(res.error).toMatch(/942 km/);
        expect(res.error).toMatch(/host needs to reset the meeting spot/);
        expect(res.error).not.toMatch(/941950/);
      }
    });

    it('still gives a walkable distance in metres', async () => {
      const { gameId } = await gameReturning();
      await unwrap(setStartSpot(repo, { gameId, hostUserId: 'host', location: { lat: 40, lng: -74 } }));

      const res = await checkIn(repo, { gameId, userId: 'uA', location: { lat: 40.004, lng: -74 } });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toMatch(/about \d+ m to go/);
        expect(res.error).not.toMatch(/reset the meeting spot/);
      }
    });
  });

  it('refuses to complete the return while a team is still out', async () => {
    const { gameId } = await gameReturning();
    await unwrap(checkIn(repo, { gameId, userId: 'uA', location: SPOT }));

    // A is back, B is not. This is the gate the host's button is built on.
    const res = await advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not checked in/);

    expect((await advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1', force: true })).ok).toBe(true);
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
    await bringEveryoneBack(repo, gameId, 'round1');
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' }));
    const mid = (await repo.get(gameId)) as Game;
    for (const asg of mid.assignments) {
      const original = mid.photos.find((p) => p.id === asg.originalPhotoId)!;
      await unwrap(submitChase(repo, { gameId, assignmentId: asg.id, location: original.location, s3Key: `chase-${asg.id}`, shooterUserId: 'x' }));
    }
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND2' }));
    await bringEveryoneBack(repo, gameId, 'round2');
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

describe('getSpectatorView', () => {
  it('resolves a join code to the public view without a scoreboard in the lobby', async () => {
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'free', config: FREE_CONFIG }),
    );
    await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'Reds' } }));

    const view = await unwrap(getSpectatorView(repo, code));
    expect(view.game.id).toBe(gameId);
    expect(view.game.state).toBe('lobby');
    expect(view.game.teams).toEqual([{ teamId: view.game.teams[0]!.teamId, name: 'Reds', memberCount: 1 }]);
    // Results aren't available yet, so no standings are shown.
    expect(view.scoreboard).toBeNull();
  });

  it('exposes no private data', async () => {
    const { code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'free', config: FREE_CONFIG }));
    const view = await unwrap(getSpectatorView(repo, code));
    expect(view.game).not.toHaveProperty('hostUserId');
    expect(view.game).not.toHaveProperty('memberships');
    expect(view.game).not.toHaveProperty('photos');
  });

  it('errors on an unknown code', async () => {
    expect((await getSpectatorView(repo, 'ZZZZZZ')).ok).toBe(false);
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

  describe('the host joins their own game', () => {
    it('puts a playing host on the team they named', async () => {
      const repo = new InMemoryGameRepository();
      const created = await createGame(repo, {
        hostUserId: 'u-host',
        tier: 'free',
        config: FREE_CONFIG,
        host: { type: 'create_team', name: 'Reds' },
      });
      expect(created.ok).toBe(true);
      const teamId = (created as { data: { teamId: string | null } }).data.teamId;
      expect(teamId).not.toBeNull();

      const game = (await repo.get((created as { data: { gameId: string } }).data.gameId))!;
      expect(game.teams.map((t) => t.name)).toEqual(['Reds']);
      const membership = game.memberships.find((m) => m.userId === 'u-host')!;
      expect(membership.teamId).toBe(teamId);
      // Captain of their team, and still the host of the game.
      expect(membership.role).toBe('captain');
      expect(game.hostUserId).toBe('u-host');
    });

    it('joins a judging host with no team at all', async () => {
      const repo = new InMemoryGameRepository();
      const created = await createGame(repo, {
        hostUserId: 'u-host',
        tier: 'free',
        config: FREE_CONFIG,
        host: { type: 'judge' },
      });
      const game = (await repo.get((created as { data: { gameId: string } }).data.gameId))!;
      expect(game.teams).toEqual([]);
      expect(game.memberships[0]).toMatchObject({ userId: 'u-host', teamId: null, role: 'judge' });
      expect((created as { data: { teamId: string | null } }).data.teamId).toBeNull();
    });

    it('refuses a team name that is only whitespace', async () => {
      // `.min(1)` alone accepts "   ", which reaches the lobby as a blank row
      // nobody can identify.
      const repo = new InMemoryGameRepository();
      const created = await createGame(repo, {
        hostUserId: 'u-host',
        tier: 'free',
        config: FREE_CONFIG,
        host: { type: 'create_team', name: '   ' },
      });
      expect(created.ok).toBe(false);
    });

    it('leaves the game empty when no participation is given', async () => {
      // The solo daily hunt builds its own teams and must not be given one.
      const repo = new InMemoryGameRepository();
      const created = await createGame(repo, { hostUserId: 'u-host', tier: 'free', config: FREE_CONFIG });
      const game = (await repo.get((created as { data: { gameId: string } }).data.gameId))!;
      expect(game.memberships).toEqual([]);
      expect(game.teams).toEqual([]);
    });

    it('lets another player join the host’s game as a second team', async () => {
      // The pair that makes a real game: host creates and plays, guest joins.
      const repo = new InMemoryGameRepository();
      const created = await createGame(repo, {
        hostUserId: 'u-host',
        tier: 'free',
        config: FREE_CONFIG,
        host: { type: 'create_team', name: 'Reds' },
      });
      const { gameId, code } = (created as { data: { gameId: string; code: string } }).data;

      const joined = await joinByCode(repo, {
        code,
        userId: 'u-guest',
        displayName: 'Ada',
        action: { type: 'create_team', name: 'Blues' },
      });
      expect(joined.ok).toBe(true);

      const game = (await repo.get(gameId))!;
      expect(game.teams.map((t) => t.name)).toEqual(['Reds', 'Blues']);
      expect(game.memberships).toHaveLength(2);
    });
  });

  describe('leaveGame', () => {
    /** A lobby with a host team and one guest team. */
    async function lobby() {
      const repo = new InMemoryGameRepository();
      const created = await createGame(repo, {
        hostUserId: 'u-host',
        tier: 'free',
        config: FREE_CONFIG,
        host: { type: 'create_team', name: 'Reds' },
      });
      const { gameId, code } = (created as { data: { gameId: string; code: string } }).data;
      await joinByCode(repo, {
        code,
        userId: 'u-guest',
        displayName: 'Ada',
        action: { type: 'create_team', name: 'Blues' },
      });
      return { repo, gameId };
    }

    it('removes the membership, and the team it emptied', async () => {
      // A team nobody is on would still count toward the minimum to start and
      // appear on the scoreboard with no players.
      const { repo, gameId } = await lobby();
      expect((await leaveGame(repo, { gameId, userId: 'u-guest' })).ok).toBe(true);

      const game = (await repo.get(gameId))!;
      expect(game.memberships.map((m) => m.userId)).toEqual(['u-host']);
      expect(game.teams.map((t) => t.name)).toEqual(['Reds']);
    });

    it('keeps a team that still has someone on it', async () => {
      const { repo, gameId } = await lobby();
      const game = (await repo.get(gameId))!;
      const blues = game.teams.find((t) => t.name === 'Blues')!;
      await joinByCode(repo, {
        code: game.code,
        userId: 'u-third',
        displayName: 'Grace',
        action: { type: 'join_team', teamId: blues.id },
      });

      await leaveGame(repo, { gameId, userId: 'u-guest' });

      const after = (await repo.get(gameId))!;
      expect(after.teams.map((t) => t.name)).toEqual(['Reds', 'Blues']);
    });

    it('refuses once the game has started', async () => {
      // Photos and votes are attached to the membership by then; removing it
      // would orphan them and leave the scoreboard wrong.
      const { repo, gameId } = await lobby();
      const game = (await repo.get(gameId))!;
      game.state = 'round1_active';
      await repo.save(game);

      const result = await leaveGame(repo, { gameId, userId: 'u-guest' });
      expect(result).toEqual({ ok: false, error: 'The game has already started.' });
    });

    it('refuses the host, who would leave a lobby nobody can start', async () => {
      const { repo, gameId } = await lobby();
      const result = await leaveGame(repo, { gameId, userId: 'u-host' });
      expect(result.ok).toBe(false);

      const game = (await repo.get(gameId))!;
      expect(game.memberships.map((m) => m.userId)).toContain('u-host');
    });

    it('refuses somebody who was never in the game', async () => {
      const { repo, gameId } = await lobby();
      expect((await leaveGame(repo, { gameId, userId: 'u-stranger' })).ok).toBe(false);
    });

    it('lets the freed-up slot be taken by someone else', async () => {
      // The point of removing the team: a two-team game is not full because
      // somebody looked in and left.
      const { repo, gameId } = await lobby();
      await leaveGame(repo, { gameId, userId: 'u-guest' });
      const game = (await repo.get(gameId))!;

      const rejoined = await joinByCode(repo, {
        code: game.code,
        userId: 'u-late',
        displayName: 'Alan',
        action: { type: 'create_team', name: 'Greens' },
      });
      expect(rejoined.ok).toBe(true);
    });
  });
});
