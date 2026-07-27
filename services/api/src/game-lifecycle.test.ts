import { DEFAULT_CONFIG, type Game } from '@photochase/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEntitlementRepository } from './entitlements-repo.js';
import { advanceGameAndSettle, settleFinishedGame, type FinishRepos } from './game-lifecycle.js';
import { attributeReferral } from './growth-handlers.js';
import { InMemoryReferralRepository } from './growth-repo.js';
import { InMemoryGameRepository } from './repository.js';
import { createTournament } from './tournament-handlers.js';
import { InMemoryTournamentRepository } from './tournament-repo.js';

/**
 * The one place a finished game is settled. Two subsystems hang off this
 * transition — referral payouts and league standings — and both were previously
 * unreachable, so what is guarded here is that finishing a game actually fires
 * them, exactly once, and only when the game really finished.
 */

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

/** Inside the 90-day attribution window from the `at: 1` attributions below. */
const FINISHED_AT = 2000;

let repos: FinishRepos;

beforeEach(() => {
  repos = {
    games: new InMemoryGameRepository(),
    referrals: new InMemoryReferralRepository(),
    entitlements: new InMemoryEntitlementRepository(),
    tournaments: new InMemoryTournamentRepository(),
  };
});

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    hostUserId: 'host',
    code: 'ABC123',
    tier: 'game_pack',
    config: DEFAULT_CONFIG,
    state: 'finals_voting',
    teams: [
      { id: 'A', gameId: 'g1', name: 'Reds', createdAt: 0 },
      { id: 'B', gameId: 'g1', name: 'Blues', createdAt: 0 },
    ],
    memberships: [
      { id: 'm1', gameId: 'g1', userId: 'p1', teamId: 'A', role: 'member', returnCheckins: {} },
      { id: 'm2', gameId: 'g1', userId: 'p2', teamId: 'B', role: 'member', returnCheckins: {} },
    ],
    photos: [],
    assignments: [],
    votes: [],
    createdAt: 0,
    ...overrides,
  };
}

const finish = (input: Partial<Parameters<typeof advanceGameAndSettle>[1]> = {}) =>
  advanceGameAndSettle(
    repos,
    { gameId: 'g1', hostUserId: 'host', event: 'COMPLETE_FINALS', ...input },
    () => FINISHED_AT,
  );

describe('referral payout on the finish', () => {
  beforeEach(async () => {
    await repos.games.save(makeGame());
  });

  it('pays every player’s referrer when the game reaches results', async () => {
    await unwrap(attributeReferral(repos.referrals, { referrerUserId: 'r1', inviteeUserId: 'p1', at: 1 }));
    await unwrap(attributeReferral(repos.referrals, { referrerUserId: 'r2', inviteeUserId: 'p2', at: 1 }));

    const advanced = await unwrap(finish());
    expect(advanced.state).toBe('results');
    expect((await repos.entitlements.getOrCreate('r1')).gameCredits).toBe(1);
    expect((await repos.entitlements.getOrCreate('r2')).gameCredits).toBe(1);
  });

  it('pays nobody on a transition that is not the finish', async () => {
    await repos.games.save(makeGame({ state: 'rating' }));
    await unwrap(attributeReferral(repos.referrals, { referrerUserId: 'r1', inviteeUserId: 'p1', at: 1 }));

    await unwrap(finish({ event: 'COMPLETE_RATING' }));
    expect((await repos.entitlements.getOrCreate('r1')).gameCredits).toBe(0);
  });

  it('pays nothing at all when the transition is refused', async () => {
    await unwrap(attributeReferral(repos.referrals, { referrerUserId: 'r1', inviteeUserId: 'p1', at: 1 }));

    const result = await finish({ event: 'END_ROUND1' });
    expect(result.ok).toBe(false);
    expect((await repos.entitlements.getOrCreate('r1')).gameCredits).toBe(0);
  });

  it('does not pay twice if the finish is replayed', async () => {
    await unwrap(attributeReferral(repos.referrals, { referrerUserId: 'r1', inviteeUserId: 'p1', at: 1 }));
    await unwrap(finish());
    await settleFinishedGame(repos, { gameId: 'g1', finishedAt: FINISHED_AT });

    expect((await repos.entitlements.getOrCreate('r1')).gameCredits).toBe(1);
  });

  it('lets only the host advance, so a player cannot force a payout', async () => {
    const result = await finish({ hostUserId: 'p1' });
    expect(result.ok).toBe(false);
  });
});

describe('league recording on the finish', () => {
  /** A league, plus a finished-shaped game attached to it. */
  async function leagueGame(): Promise<string> {
    await repos.entitlements.save({ userId: 'owner', tier: 'unlimited', gameCredits: 0, subscriptionActive: true });
    const { tournamentId } = await unwrap(
      createTournament(repos.tournaments, repos.entitlements, { name: 'League', ownerUserId: 'owner' }),
    );
    await repos.games.save(makeGame({ tournamentId }));
    return tournamentId;
  }

  it('records the game against its league when it finishes', async () => {
    const tournamentId = await leagueGame();
    await unwrap(finish());

    const league = (await repos.tournaments.get(tournamentId))!;
    expect(league.results).toHaveLength(1);
    expect(league.results[0]!.gameId).toBe('g1');
    // Keyed by name, so next week's game accumulates onto the same rows.
    expect(league.results[0]!.placements.map((p) => p.teamKey).sort()).toEqual(['blues', 'reds']);
  });

  it('records nothing for a game that belongs to no league', async () => {
    await repos.games.save(makeGame());
    const report = await settleFinishedGame(repos, { gameId: 'g1', finishedAt: FINISHED_AT });
    expect(report.recordedInLeague).toBe(false);
  });

  it('does not double-count a replayed finish', async () => {
    const tournamentId = await leagueGame();
    await unwrap(finish());
    const again = await settleFinishedGame(repos, { gameId: 'g1', finishedAt: FINISHED_AT });

    expect(again.recordedInLeague).toBe(false);
    expect((await repos.tournaments.get(tournamentId))!.results).toHaveLength(1);
  });

  it('records nothing when the transition is refused', async () => {
    const tournamentId = await leagueGame();
    const result = await finish({ event: 'END_ROUND1' });

    expect(result.ok).toBe(false);
    expect((await repos.tournaments.get(tournamentId))!.results).toHaveLength(0);
  });

  it('settles referrals even when the league is missing', async () => {
    // A deleted league must not swallow the payout half of the settlement.
    await repos.games.save(makeGame({ tournamentId: 'gone' }));
    await unwrap(attributeReferral(repos.referrals, { referrerUserId: 'r1', inviteeUserId: 'p1', at: 1 }));

    const report = await settleFinishedGame(repos, { gameId: 'g1', finishedAt: FINISHED_AT });
    expect(report.recordedInLeague).toBe(false);
    expect(report.creditedUserIds).toEqual(['p1']);
  });
});
