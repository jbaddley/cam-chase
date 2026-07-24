import { DEFAULT_CONFIG, type Game, type Photo, type TeamScore } from '@photochase/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryGameRepository } from './repository.js';
import { InMemoryTournamentRepository } from './tournament-repo.js';
import {
  createTournament,
  generateGameRecap,
  getStandings,
  recordGameResult,
} from './tournament-handlers.js';

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

function board(...totals: Array<[string, number]>): TeamScore[] {
  return totals.map(([teamId, total]) => ({
    teamId,
    location: 0,
    pose: 0,
    angle: 0,
    timeBonus: 0,
    bestMatchBonus: 0,
    specialBonus: 0,
    foulPenalty: 0,
    total,
  }));
}

describe('tournament standings via handlers', () => {
  let repo: InMemoryTournamentRepository;
  beforeEach(() => {
    repo = new InMemoryTournamentRepository();
  });

  it('aggregates recorded games into standings', async () => {
    const { tournamentId } = await unwrap(createTournament(repo, { name: 'Summer League' }));
    await unwrap(recordGameResult(repo, { tournamentId, gameId: 'g1', scoreboard: board(['A', 200], ['B', 150]) }));
    await unwrap(recordGameResult(repo, { tournamentId, gameId: 'g2', scoreboard: board(['A', 180], ['B', 170]) }));
    const standings = await unwrap(getStandings(repo, tournamentId));
    expect(standings[0]!.teamKey).toBe('A');
    expect(standings[0]!.wins).toBe(2);
  });

  it('rejects recording the same game twice', async () => {
    const { tournamentId } = await unwrap(createTournament(repo, { name: 'League' }));
    await unwrap(recordGameResult(repo, { tournamentId, gameId: 'g1', scoreboard: board(['A', 100]) }));
    const dup = await recordGameResult(repo, { tournamentId, gameId: 'g1', scoreboard: board(['A', 100]) });
    expect(dup.ok).toBe(false);
  });
});

describe('generateGameRecap', () => {
  it('produces a recap naming the winning team', async () => {
    const games = new InMemoryGameRepository();
    const photo = (id: string, teamId: string): Photo => ({
      id, gameId: 'g1', teamId, shooterUserId: 'u', order: 0,
      location: { lat: 40, lng: -74 }, capturedAt: 0, s3Key: `${id}.jpg`, fouls: [],
    });
    const game: Game = {
      id: 'g1', hostUserId: 'host', code: 'ABC123', tier: 'game_pack',
      config: DEFAULT_CONFIG, state: 'results',
      teams: [
        { id: 'A', gameId: 'g1', name: 'Red Foxes', createdAt: 0 },
        { id: 'B', gameId: 'g1', name: 'Blue Jays', createdAt: 0 },
      ],
      memberships: [{ id: 'm', gameId: 'g1', userId: 'uB', teamId: 'B', role: 'captain', returnCheckins: {} }],
      photos: [photo('oB', 'B'), photo('cA', 'A')],
      assignments: [{ id: 'a1', gameId: 'g1', chaserTeamId: 'A', originalPhotoId: 'oB', order: 0, chasePhotoId: 'cA' }],
      votes: [{ id: 'v', gameId: 'g1', assignmentId: 'a1', voterUserId: 'uB', axis: 'pose', stars: 5 }],
      createdAt: 0,
    };
    await games.save(game);

    const { recap } = await unwrap(generateGameRecap(games, { gameId: 'g1' }));
    expect(recap).toContain('Red Foxes'); // A leads on the exact-match chase
  });
});
