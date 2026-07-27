import {
  BLUFF_POINTS,
  DEFAULT_CONFIG,
  ELEMENT_POINTS,
  attributeElements,
  type Game,
  type GameConfig,
} from '@photochase/shared';
import { describe, expect, it } from 'vitest';
import {
  advanceGame,
  castVote,
  createGame,
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
 * Full-game simulation gate for Colour Hunt, mirroring the chase and hunt
 * simulations. Bots play a complete game through the real handlers — create,
 * join, secret assignment, shooting, the guessing window, validity judging,
 * results — and the final scoreboard is asserted exactly, so any drift in
 * assignment, guess scoring or the bluff bonus fails the build.
 */

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.data;
}

const CONFIG: GameConfig = {
  ...DEFAULT_CONFIG,
  mode: 'color_hunt',
  colorSpecificity: 'color_plus',
  maxTeams: 3,
  photosPerRound: 5,
  judgeWeight: 3,
};

const SPOT = { lat: 40, lng: -74 };

describe('full colour-hunt simulation', () => {
  it('plays a 3-team colour hunt end to end with an exact final scoreboard', async () => {
    const repo = new InMemoryGameRepository();

    // --- create + join -------------------------------------------------------
    const { gameId, code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: CONFIG }));

    const bots = [];
    for (let t = 0; t < 3; t++) {
      const name = `Team ${String.fromCharCode(65 + t)}`;
      const joined = await unwrap(
        joinByCode(repo, { code, userId: `u${t}`, displayName: name, action: { type: 'create_team', name } }),
      );
      bots.push({ userId: `u${t}`, teamId: joined.teamId! });
    }
    await unwrap(joinByCode(repo, { code, userId: 'judge', displayName: 'Judge', action: { type: 'judge' } }));

    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));

    // --- secrets: each team sees exactly its own ----------------------------
    const secrets = ((await repo.get(gameId)) as Game).color!.secrets;
    for (const bot of bots) {
      const view = await unwrap(getMySecret(repo, { gameId, userId: bot.userId }));
      expect(view.teamId).toBe(bot.teamId);
      expect(view.secret).toEqual(secrets[bot.teamId]);
    }
    // No two teams share a colour, or a correct guess would be ambiguous.
    const colors = bots.map((bot) => secrets[bot.teamId]!.color);
    expect(new Set(colors).size).toBe(3);

    // --- Round 1: everyone shoots their quota --------------------------------
    for (const bot of bots) {
      for (let i = 0; i < CONFIG.photosPerRound; i++) {
        await unwrap(
          submitPhoto(repo, { gameId, teamId: bot.teamId, shooterUserId: bot.userId, location: SPOT, s3Key: `${bot.userId}-${i}` }),
        );
      }
    }

    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));
    expect(((await repo.get(gameId)) as Game).state).toBe('guessing');

    // --- Guessing ------------------------------------------------------------
    const [teamA, teamB, teamC] = bots;

    // Everyone sees two targets and no secrets in the payload.
    for (const bot of bots) {
      const targets = await unwrap(listGuessTargets(repo, { gameId, userId: bot.userId }));
      expect(targets).toHaveLength(2);
      expect(targets.map((t) => t.teamId)).not.toContain(bot.teamId);
    }

    // A reads both perfectly. B reads only C's colour. C guesses nothing.
    for (const subject of [teamB!, teamC!]) {
      await unwrap(
        submitGuess(repo, { gameId, userId: teamA!.userId, subjectTeamId: subject.teamId, guess: { ...secrets[subject.teamId]! } }),
      );
    }
    await unwrap(
      submitGuess(repo, { gameId, userId: teamB!.userId, subjectTeamId: teamC!.teamId, guess: { color: secrets[teamC!.teamId]!.color } }),
    );

    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'CLOSE_GUESSING' }));
    expect(((await repo.get(gameId)) as Game).state).toBe('rating');

    // --- Judging: confirm everyone except C, whose attribute is voted down ---
    const queue = await unwrap(listRateable(repo, { gameId, userId: 'judge' }));
    expect(queue).toHaveLength(3 * CONFIG.photosPerRound);
    expect(queue.every((r) => r.itemLabel !== undefined)).toBe(true);

    for (const claim of queue) {
      const stars = claim.itemId === teamC!.teamId ? 1 : 5;
      await unwrap(castVote(repo, { gameId, assignmentId: claim.assignmentId, voterUserId: 'judge', axis: 'validity', stars }));
    }

    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RATING' }));

    // --- Results -------------------------------------------------------------
    const { scoreboard } = await unwrap(getResults(repo, gameId));
    const byTeam = new Map(scoreboard.map((s) => [s.teamId, s]));
    const a = byTeam.get(teamA!.teamId)!;
    const b = byTeam.get(teamB!.teamId)!;
    const c = byTeam.get(teamC!.teamId)!;

    const sizeOf = (teamId: string) => attributeElements(secrets[teamId]!).length;

    // A read both secrets in full.
    expect(a.location).toBe((sizeOf(teamB!.teamId) + sizeOf(teamC!.teamId)) * ELEMENT_POINTS);
    // B got only C's colour, so one element out of C's set.
    expect(b.location).toBe(ELEMENT_POINTS);
    // C guessed nothing at all.
    expect(c.location).toBe(0);

    // A was never guessed about, so it bluffed nobody and scores nothing for it.
    expect(a.pose).toBe(0);
    // B was read perfectly by A, so no bluff bonus either.
    expect(b.pose).toBe(0);
    // C was read perfectly by A and partially by B — but its attribute was
    // voted down, so every element it "hid" pays nothing.
    expect(c.pose).toBe(0);

    for (const s of scoreboard) {
      expect(s.angle).toBe(0);
      expect(s.timeBonus).toBe(0);
      expect(s.total).toBe(
        s.location + s.pose + s.angle + s.timeBonus + s.bestMatchBonus + s.specialBonus - s.foulPenalty,
      );
    }
    expect([...scoreboard].sort((x, y) => y.total - x.total)[0]!.teamId).toBe(teamA!.teamId);
    expect(((await repo.get(gameId)) as Game).state).toBe('results');
  });

  it('pays the bluff when the attribute is confirmed', async () => {
    // The mirror of the case above: with judging on C's side, hiding pays.
    const repo = new InMemoryGameRepository();
    const { gameId, code } = await unwrap(
      createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: { ...CONFIG, maxTeams: 2 } }),
    );
    const a = await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    const b = await unwrap(joinByCode(repo, { code, userId: 'uB', displayName: 'B', action: { type: 'create_team', name: 'B' } }));
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));

    const secrets = ((await repo.get(gameId)) as Game).color!.secrets;
    await unwrap(submitPhoto(repo, { gameId, teamId: b.teamId!, shooterUserId: 'uB', location: SPOT, s3Key: 'b0' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_ROUND1' }));

    // A guesses everything wrong about B.
    const wrong = secrets[b.teamId!]!.color === 'red' ? 'blue' : 'red';
    await unwrap(submitGuess(repo, { gameId, userId: 'uA', subjectTeamId: b.teamId!, guess: { color: wrong } }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'CLOSE_GUESSING' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RATING' }));

    const { scoreboard } = await unwrap(getResults(repo, gameId));
    const bScore = scoreboard.find((s) => s.teamId === b.teamId)!;
    expect(bScore.pose).toBe(attributeElements(secrets[b.teamId!]!).length * BLUFF_POINTS);
    expect(scoreboard.find((s) => s.teamId === a.teamId)!.location).toBe(0);
  });

  it('refuses a chase event, which a colour hunt has no such phase for', async () => {
    const repo = new InMemoryGameRepository();
    const { gameId, code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: CONFIG }));
    for (const t of [0, 1]) {
      await unwrap(joinByCode(repo, { code, userId: `u${t}`, displayName: `T${t}`, action: { type: 'create_team', name: `T${t}` } }));
    }
    await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));

    expect((await advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_RETURN1' })).ok).toBe(false);
  });
});
