import { DEFAULT_CONFIG, ELEMENT_POINTS, BLUFF_POINTS, type Game, type GameConfig } from '@photochase/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  advanceGame,
  castVote,
  createGame,
  flagFoul,
  getMySecret,
  getResults,
  joinByCode,
  listGuessTargets,
  listRateable,
  startGame,
  submitGuess,
  submitPhoto,
} from './handlers.js';
import { InMemoryGameRepository } from './repository.js';

/**
 * Handler-level coverage for Colour Hunt. Most of the plumbing is shared with
 * the other modes, so what is tested here is only what differs: secret
 * assignment and its scoping, the guessing window, and the bluff bonus that
 * only works if validity has teeth.
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

const COLOR_CONFIG: GameConfig = {
  ...DEFAULT_CONFIG,
  mode: 'color_hunt',
  colorSpecificity: 'color_plus',
  maxTeams: 2,
  photosPerRound: 5,
};

const SPOT = { lat: 40, lng: -74 };

/** A started colour hunt with two teams and a judge. */
async function started(config: Partial<GameConfig> = {}) {
  const { gameId, code } = await unwrap(
    createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: { ...COLOR_CONFIG, ...config } }),
  );
  const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
  const b = await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
  await unwrap(joinByCode(repo, { code, userId: 'judge', displayName: 'J', action: { type: 'judge' } }));
  await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
  return { gameId, teamA: a.teamId!, teamB: b.teamId! };
}

const secretsOf = async (gameId: string) => ((await repo.get(gameId)) as Game).color!.secrets;

describe('secret assignment', () => {
  it('deals a secret to every team when the game starts', async () => {
    const { gameId, teamA, teamB } = await started();
    const secrets = await secretsOf(gameId);
    expect(Object.keys(secrets).sort()).toEqual([teamA, teamB].sort());
  });

  it('deals nothing before the game starts, when the teams are not known', async () => {
    const { gameId } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: COLOR_CONFIG }));
    expect(((await repo.get(gameId)) as Game).color).toBeUndefined();
  });

  it('gives the plus level a modifier and the simple level none', async () => {
    const plus = await started();
    for (const secret of Object.values(await secretsOf(plus.gameId))) {
      expect([secret.shape, secret.motif].filter(Boolean)).toHaveLength(1);
    }

    repo = new InMemoryGameRepository();
    const simple = await started({ colorSpecificity: 'simple' });
    for (const secret of Object.values(await secretsOf(simple.gameId))) {
      expect(secret.shape).toBeUndefined();
      expect(secret.motif).toBeUndefined();
    }
  });
});

describe('getMySecret', () => {
  it('gives a player their own team’s secret', async () => {
    const { gameId, teamA } = await started();
    const view = await unwrap(getMySecret(repo, { gameId, userId: 'uA' }));
    expect(view.teamId).toBe(teamA);
    expect(view.description).toContain(view.secret.color);
  });

  it('never leaks another team’s secret', async () => {
    // Reading someone else's secret is the entire game, so this is the
    // equivalent of the chase's assignment scoping.
    const { gameId, teamA, teamB } = await started();
    const forA = await unwrap(getMySecret(repo, { gameId, userId: 'uA' }));
    const forB = await unwrap(getMySecret(repo, { gameId, userId: 'uB' }));
    expect(forA.teamId).toBe(teamA);
    expect(forB.teamId).toBe(teamB);
    expect(forA.secret).not.toEqual(forB.secret);
  });

  it('gives a judge no secret, since they have no team', async () => {
    const { gameId } = await started();
    expect((await getMySecret(repo, { gameId, userId: 'judge' })).ok).toBe(false);
  });

  it('refuses someone outside the game', async () => {
    const { gameId } = await started();
    expect((await getMySecret(repo, { gameId, userId: 'stranger' })).ok).toBe(false);
  });

  it('refuses a game that is not a colour hunt', async () => {
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: DEFAULT_CONFIG }),
    );
    await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    expect((await getMySecret(repo, { gameId, userId: 'uA' })).ok).toBe(false);
  });
});

describe('listGuessTargets', () => {
  /** Both teams shoot, then the host opens guessing. */
  async function inGuessing() {
    const game = await started();
    for (const [teamId, userId] of [[game.teamA, 'uA'], [game.teamB, 'uB']] as const) {
      await unwrap(submitPhoto(repo, { gameId: game.gameId, teamId, shooterUserId: userId, location: SPOT, s3Key: `${userId}-1` }));
    }
    await unwrap(advanceGame(repo, { gameId: game.gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    return game;
  }

  it('lists the other teams with their photos to study', async () => {
    const { gameId, teamB } = await inGuessing();
    const targets = await unwrap(listGuessTargets(repo, { gameId, userId: 'uA' }));
    expect(targets).toHaveLength(1);
    expect(targets[0]!.teamId).toBe(teamB);
    expect(targets[0]!.photoKeys).toEqual(['uB-1']);
  });

  it('excludes the caller’s own team — you know your own secret', async () => {
    const { gameId, teamA } = await inGuessing();
    const targets = await unwrap(listGuessTargets(repo, { gameId, userId: 'uA' }));
    expect(targets.map((t) => t.teamId)).not.toContain(teamA);
  });

  it('carries no secret at all, only the photos', async () => {
    const { gameId } = await inGuessing();
    const [target] = await unwrap(listGuessTargets(repo, { gameId, userId: 'uA' }));
    expect(JSON.stringify(target)).not.toMatch(/"color":/);
  });

  it('reports this team’s committed guess so a revisit is not a blank slate', async () => {
    const { gameId, teamB } = await inGuessing();
    await unwrap(submitGuess(repo, { gameId, userId: 'uA', subjectTeamId: teamB, guess: { color: 'red' } }));

    const [target] = await unwrap(listGuessTargets(repo, { gameId, userId: 'uA' }));
    expect(target!.myGuess).toEqual({ color: 'red' });
  });

  it('gives a judge every team, since they are on none', async () => {
    const { gameId } = await inGuessing();
    expect(await unwrap(listGuessTargets(repo, { gameId, userId: 'judge' }))).toHaveLength(2);
  });
});

describe('submitGuess', () => {
  async function inGuessing() {
    const game = await started();
    await unwrap(advanceGame(repo, { gameId: game.gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    return game;
  }

  it('commits a guess about another team', async () => {
    const { gameId, teamA, teamB } = await inGuessing();
    await unwrap(submitGuess(repo, { gameId, userId: 'uA', subjectTeamId: teamB, guess: { color: 'red', shape: 'round' } }));

    const guesses = ((await repo.get(gameId)) as Game).color!.guesses;
    expect(guesses).toHaveLength(1);
    expect(guesses[0]).toEqual({ guesserTeamId: teamA, subjectTeamId: teamB, guess: { color: 'red', shape: 'round' } });
  });

  it('replaces rather than stacks, so a team can revise while studying', async () => {
    const { gameId, teamB } = await inGuessing();
    await unwrap(submitGuess(repo, { gameId, userId: 'uA', subjectTeamId: teamB, guess: { color: 'red' } }));
    await unwrap(submitGuess(repo, { gameId, userId: 'uA', subjectTeamId: teamB, guess: { color: 'blue' } }));

    const guesses = ((await repo.get(gameId)) as Game).color!.guesses;
    expect(guesses).toHaveLength(1);
    expect(guesses[0]!.guess).toEqual({ color: 'blue' });
  });

  it('refuses a guess about your own team', async () => {
    const { gameId, teamA } = await inGuessing();
    expect((await submitGuess(repo, { gameId, userId: 'uA', subjectTeamId: teamA, guess: { color: 'red' } })).ok).toBe(false);
  });

  it('refuses a guess before the window opens', async () => {
    const { gameId, teamB } = await started();
    expect((await submitGuess(repo, { gameId, userId: 'uA', subjectTeamId: teamB, guess: { color: 'red' } })).ok).toBe(false);
  });

  it('refuses a guess after the host closes the window', async () => {
    const { gameId, teamB } = await inGuessing();
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'CLOSE_GUESSING' }));
    expect((await submitGuess(repo, { gameId, userId: 'uA', subjectTeamId: teamB, guess: { color: 'red' } })).ok).toBe(false);
  });

  it('refuses a judge, who is on no team and so cannot guess', async () => {
    const { gameId, teamB } = await inGuessing();
    expect((await submitGuess(repo, { gameId, userId: 'judge', subjectTeamId: teamB, guess: { color: 'red' } })).ok).toBe(false);
  });

  it('refuses a subject that is not a team in this game', async () => {
    const { gameId } = await inGuessing();
    expect((await submitGuess(repo, { gameId, userId: 'uA', subjectTeamId: 'ghost', guess: { color: 'red' } })).ok).toBe(false);
  });
});

describe('rating and results', () => {
  /** A finished-shaped game where A guessed B perfectly and B guessed nothing. */
  async function played(input: { aReadsB: boolean }) {
    const game = await started();
    const secrets = await secretsOf(game.gameId);
    for (const [teamId, userId] of [[game.teamA, 'uA'], [game.teamB, 'uB']] as const) {
      await unwrap(
        submitPhoto(repo, { gameId: game.gameId, teamId, shooterUserId: userId, location: SPOT, s3Key: `${userId}-1` }),
      );
    }
    await unwrap(advanceGame(repo, { gameId: game.gameId, hostUserId: 'host', event: 'END_ROUND1' }));

    const secretB = secrets[game.teamB]!;
    await unwrap(
      submitGuess(repo, {
        gameId: game.gameId,
        userId: 'uA',
        subjectTeamId: game.teamB,
        guess: input.aReadsB ? { ...secretB } : { color: secretB.color === 'red' ? 'blue' : 'red' },
      }),
    );
    await unwrap(advanceGame(repo, { gameId: game.gameId, hostUserId: 'host', event: 'CLOSE_GUESSING' }));
    return { ...game, secrets };
  }

  const scoreFor = async (gameId: string, teamId: string) => {
    const board = await unwrap(getResults(repo, gameId));
    return board.scoreboard.find((s) => s.teamId === teamId)!;
  };

  it('pays the reader for every element they got right', async () => {
    const { gameId, teamA, teamB, secrets } = await played({ aReadsB: true });
    const elements = [secrets[teamB]!.color, secrets[teamB]!.shape, secrets[teamB]!.motif].filter(Boolean).length;
    expect((await scoreFor(gameId, teamA)).location).toBe(elements * ELEMENT_POINTS);
  });

  it('pays the bluffer for every element the reader got wrong', async () => {
    const { gameId, teamB, secrets } = await played({ aReadsB: false });
    const elements = [secrets[teamB]!.color, secrets[teamB]!.shape, secrets[teamB]!.motif].filter(Boolean).length;
    expect((await scoreFor(gameId, teamB)).pose).toBe(elements * BLUFF_POINTS);
  });

  it('reveals the secret in the rating queue, so judges know what to check', async () => {
    const { gameId, secrets, teamB } = await played({ aReadsB: false });
    const queue = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    const forB = queue.find((r) => r.itemId === teamB)!;
    expect(forB.itemLabel).toContain(secrets[teamB]!.color);
  });

  it('voids the bluff bonus when judges say the attribute was not there', async () => {
    // Otherwise the winning strategy is to omit the attribute entirely, which
    // is unguessable — the bluff bonus needs a real validity check behind it.
    const { gameId, teamB } = await played({ aReadsB: false });
    const queue = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    for (const claim of queue.filter((r) => r.itemId === teamB)) {
      await unwrap(castVote(repo, { gameId, assignmentId: claim.assignmentId, voterUserId: 'judge', axis: 'validity', stars: 1 }));
    }
    expect((await scoreFor(gameId, teamB)).pose).toBe(0);
  });

  it('voids the bluff bonus on a missing-item foul, without also fining', async () => {
    const { gameId, teamB } = await played({ aReadsB: false });
    const queue = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    const forB = queue.find((r) => r.itemId === teamB)!;
    await unwrap(flagFoul(repo, { gameId, photoId: forB.originalPhotoId, userId: 'judge', reason: 'missing_item' }));

    const score = await scoreFor(gameId, teamB);
    expect(score.pose).toBe(0);
    expect(score.foulPenalty).toBe(0);
  });

  it('pays a bluff nobody judged, since most games have no moderator', async () => {
    const { gameId, teamB } = await played({ aReadsB: false });
    expect((await scoreFor(gameId, teamB)).pose).toBeGreaterThan(0);
  });

  it('still pays the reader when the subject was not confirmed', async () => {
    const { gameId, teamA, teamB } = await played({ aReadsB: true });
    const queue = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    for (const claim of queue.filter((r) => r.itemId === teamB)) {
      await unwrap(castVote(repo, { gameId, assignmentId: claim.assignmentId, voterUserId: 'judge', axis: 'validity', stars: 1 }));
    }
    expect((await scoreFor(gameId, teamA)).location).toBeGreaterThan(0);
  });

  it('refuses pose and angle votes, which this mode never scores', async () => {
    const { gameId } = await played({ aReadsB: true });
    const [claim] = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    expect((await castVote(repo, { gameId, assignmentId: claim!.assignmentId, voterUserId: 'judge', axis: 'pose', stars: 5 })).ok).toBe(
      false,
    );
  });

  it('awards no return bonus, since a colour hunt has no return phase', async () => {
    const { gameId, teamA } = await played({ aReadsB: true });
    expect((await scoreFor(gameId, teamA)).timeBonus).toBe(0);
  });
});
