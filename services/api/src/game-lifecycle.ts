import type { Game, GameEvent } from '@photochase/shared';
import type { EntitlementRepository } from './entitlements-repo.js';
import { advanceGame, type Result } from './handlers.js';
import { creditReferralsForFinishedGame } from './growth-handlers.js';
import type { ReferralRepository } from './growth-repo.js';
import type { GameRepository } from './repository.js';
import { recordGameResult } from './tournament-handlers.js';
import type { TournamentRepository } from './tournament-repo.js';

/**
 * Everything that has to happen when a game ends.
 *
 * Two independent subsystems care about the `results` transition — referral
 * payouts and league standings — and both were previously reachable only by
 * someone remembering to call them. Composing them at the one transition that
 * triggers them is what keeps them alive; a second call site is how these drift
 * apart and one of them quietly stops running.
 */
export interface FinishRepos {
  games: GameRepository;
  referrals: ReferralRepository;
  entitlements: EntitlementRepository;
  tournaments: TournamentRepository;
}

export interface SettlementReport {
  state: Game['state'];
  /** Referrers paid by this finish. */
  creditedUserIds: string[];
  /** Whether the game was added to its league table. */
  recordedInLeague: boolean;
}

/**
 * Settle a finished game: pay referrals, and record it against its league if it
 * belongs to one. Idempotent — the referral engine refuses an already-credited
 * referral and the league refuses a game already in its table — so replaying the
 * finish pays nobody twice and never double-counts a night.
 */
export async function settleFinishedGame(
  repos: FinishRepos,
  input: { gameId: string; finishedAt: number },
): Promise<SettlementReport & { state: 'results' }> {
  const credited = await creditReferralsForFinishedGame(repos.games, repos.referrals, repos.entitlements, {
    gameId: input.gameId,
    finishedAt: input.finishedAt,
  });

  const game = await repos.games.get(input.gameId);
  let recordedInLeague = false;
  if (game?.tournamentId) {
    const recorded = await recordGameResult(repos.tournaments, repos.games, {
      tournamentId: game.tournamentId,
      gameId: input.gameId,
    });
    recordedInLeague = recorded.ok && recorded.data.recorded;
  }

  return {
    state: 'results',
    creditedUserIds: credited.ok ? credited.data.creditedUserIds : [],
    recordedInLeague,
  };
}

/**
 * Advance a game, settling it if that transition ends it. A refused transition
 * settles nothing — a player must not be able to trigger a payout by asking for
 * an illegal move.
 */
export async function advanceGameAndSettle(
  repos: FinishRepos,
  input: { gameId: string; hostUserId: string; event: GameEvent['type']; force?: boolean },
  now = Date.now,
): Promise<Result<{ state: Game['state'] }>> {
  const advanced = await advanceGame(repos.games, input);
  if (!advanced.ok) return advanced;
  if (advanced.data.state === 'results') {
    await settleFinishedGame(repos, { gameId: input.gameId, finishedAt: now() });
  }
  return advanced;
}
