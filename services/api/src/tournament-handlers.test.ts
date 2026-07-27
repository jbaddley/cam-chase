import { DEFAULT_CONFIG, type Game, type Photo } from '@photochase/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEntitlementRepository } from './entitlements-repo.js';
import { InMemoryGameRepository } from './repository.js';
import { InMemoryTournamentRepository } from './tournament-repo.js';
import {
  createTournament,
  generateGameRecap,
  getStandingsByCode,
  recordGameResult,
} from './tournament-handlers.js';

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

let repo: InMemoryTournamentRepository;
let games: InMemoryGameRepository;
let entRepo: InMemoryEntitlementRepository;

beforeEach(() => {
  repo = new InMemoryTournamentRepository();
  games = new InMemoryGameRepository();
  entRepo = new InMemoryEntitlementRepository();
});

/** Give a user a plan that can start a league. */
async function makePaid(userId: string) {
  await entRepo.save({ userId, tier: 'unlimited', gameCredits: 0, subscriptionActive: true });
}

const photo = (id: string, teamId: string, gameId = 'g1'): Photo => ({
  id,
  gameId,
  teamId,
  shooterUserId: 'u',
  order: 0,
  location: { lat: 40, lng: -74 },
  capturedAt: 0,
  s3Key: `${id}.jpg`,
  fouls: [],
});

/**
 * A finished game where team `winner` beat the other on an exact-match chase.
 * Team ids are unique per game, exactly as the real handlers mint them.
 */
async function finishedGame(gameId: string, names: [string, string]): Promise<Game> {
  const [winnerName, loserName] = names;
  const winnerTeam = `${gameId}_win`;
  const loserTeam = `${gameId}_lose`;
  const game: Game = {
    id: gameId,
    hostUserId: 'host',
    code: gameId.toUpperCase(),
    tier: 'game_pack',
    config: DEFAULT_CONFIG,
    state: 'results',
    teams: [
      { id: winnerTeam, gameId, name: winnerName, createdAt: 0 },
      { id: loserTeam, gameId, name: loserName, createdAt: 0 },
    ],
    memberships: [{ id: 'm', gameId, userId: 'uB', teamId: loserTeam, role: 'captain', returnCheckins: {} }],
    photos: [photo('orig', loserTeam, gameId), photo('chase', winnerTeam, gameId)],
    assignments: [
      { id: 'a1', gameId, chaserTeamId: winnerTeam, originalPhotoId: 'orig', order: 0, chasePhotoId: 'chase' },
    ],
    votes: [{ id: 'v', gameId, assignmentId: 'a1', voterUserId: 'uB', axis: 'pose', stars: 5 }],
    createdAt: 0,
  };
  await games.save(game);
  return game;
}

describe('createTournament', () => {
  it('creates a league with a shareable code', async () => {
    await makePaid('owner');
    const { tournamentId, code } = await unwrap(createTournament(repo, entRepo, { name: 'Summer League', ownerUserId: 'owner' }));
    expect(code).toHaveLength(6);
    const saved = (await repo.get(tournamentId))!;
    expect(saved.name).toBe('Summer League');
    expect(saved.ownerUserId).toBe('owner');
  });

  it('refuses a free user, since starting a league is the paid power', async () => {
    const result = await createTournament(repo, entRepo, { name: 'League', ownerUserId: 'freeloader' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/paid plan/);
  });

  it('rejects an empty name', async () => {
    await makePaid('owner');
    expect((await createTournament(repo, entRepo, { name: '   ', ownerUserId: 'owner' })).ok).toBe(false);
  });

  it('gives each league its own code', async () => {
    await makePaid('owner');
    const a = await unwrap(createTournament(repo, entRepo, { name: 'A', ownerUserId: 'owner' }));
    const b = await unwrap(createTournament(repo, entRepo, { name: 'B', ownerUserId: 'owner' }));
    expect(a.code).not.toBe(b.code);
  });
});

describe('recordGameResult', () => {
  async function league() {
    await makePaid('owner');
    return unwrap(createTournament(repo, entRepo, { name: 'League', ownerUserId: 'owner' }));
  }

  it('accumulates a team across games despite per-game team ids', async () => {
    // The whole point of the league table: week 2's "Reds" is week 1's "Reds",
    // even though the two games minted different team ids for them.
    const { tournamentId, code } = await league();
    await finishedGame('g1', ['Reds', 'Blues']);
    await finishedGame('g2', ['Reds', 'Blues']);
    await unwrap(recordGameResult(repo, games, { tournamentId, gameId: 'g1' }));
    await unwrap(recordGameResult(repo, games, { tournamentId, gameId: 'g2' }));

    const view = await unwrap(getStandingsByCode(repo, code));
    expect(view.standings).toHaveLength(2);
    expect(view.standings[0]!.teamName).toBe('Reds');
    expect(view.standings[0]!.wins).toBe(2);
    expect(view.standings[0]!.gamesPlayed).toBe(2);
  });

  it('ignores a game already in the table rather than erroring', async () => {
    // The results transition can replay; a league that double-counted a night
    // would be worse than one that shrugged off the repeat.
    const { tournamentId } = await league();
    await finishedGame('g1', ['Reds', 'Blues']);
    await unwrap(recordGameResult(repo, games, { tournamentId, gameId: 'g1' }));

    const again = await unwrap(recordGameResult(repo, games, { tournamentId, gameId: 'g1' }));
    expect(again.recorded).toBe(false);
    expect((await repo.get(tournamentId))!.results).toHaveLength(1);
  });

  it('refuses a league that does not exist', async () => {
    await finishedGame('g1', ['Reds', 'Blues']);
    expect((await recordGameResult(repo, games, { tournamentId: 'nope', gameId: 'g1' })).ok).toBe(false);
  });

  it('refuses a game that does not exist', async () => {
    const { tournamentId } = await league();
    expect((await recordGameResult(repo, games, { tournamentId, gameId: 'nope' })).ok).toBe(false);
  });

  it('refuses a game that has not reached a scorable phase', async () => {
    const { tournamentId } = await league();
    const game = await finishedGame('g1', ['Reds', 'Blues']);
    await games.save({ ...game, state: 'round1_active' });
    expect((await recordGameResult(repo, games, { tournamentId, gameId: 'g1' })).ok).toBe(false);
  });
});

describe('getStandingsByCode', () => {
  it('resolves a league by the code it is shared by', async () => {
    await makePaid('owner');
    const { code } = await unwrap(createTournament(repo, entRepo, { name: 'Summer League', ownerUserId: 'owner' }));
    const view = await unwrap(getStandingsByCode(repo, code));
    expect(view.name).toBe('Summer League');
    expect(view.gamesPlayed).toBe(0);
    expect(view.standings).toEqual([]);
  });

  it('accepts a code typed in lower case', async () => {
    await makePaid('owner');
    const { code } = await unwrap(createTournament(repo, entRepo, { name: 'League', ownerUserId: 'owner' }));
    expect((await getStandingsByCode(repo, code.toLowerCase())).ok).toBe(true);
  });

  it('refuses a code nobody owns', async () => {
    expect((await getStandingsByCode(repo, 'NOSUCH')).ok).toBe(false);
  });
});

describe('generateGameRecap', () => {
  it('produces a recap naming the winning team', async () => {
    await finishedGame('g1', ['Red Foxes', 'Blue Jays']);
    const { recap } = await unwrap(generateGameRecap(games, { gameId: 'g1' }));
    expect(recap).toContain('Red Foxes'); // leads on the exact-match chase
  });

  it('refuses a game that does not exist', async () => {
    expect((await generateGameRecap(games, { gameId: 'nope' })).ok).toBe(false);
  });
});
