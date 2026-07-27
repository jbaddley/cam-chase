import {
  aggregateStandings,
  canUseFeature,
  generateRecap,
  placementsFromScoreboard,
  type Standing,
} from '@photochase/shared';
import { z } from 'zod';
import type { EntitlementRepository } from './entitlements-repo.js';
import { getResults, type Result } from './handlers.js';
import { newId, newJoinCode } from './ids.js';
import type { GameRepository } from './repository.js';
import type { Tournament, TournamentRepository } from './tournament-repo.js';

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const err = (error: string): Result<never> => ({ ok: false, error });

const CreateTournamentInput = z.object({
  // Trimmed before the length check, so a name of only spaces is not a name.
  name: z.string().max(60).transform((s) => s.trim()).pipe(z.string().min(1)),
  ownerUserId: z.string().min(1),
});

/**
 * Create a league season.
 *
 * Creating is the paid power; joining and playing in someone else's league is
 * free. That is deliberate — a league is only worth anything if the people in
 * it can actually turn up, so the cost sits with the one person organising it.
 */
export async function createTournament(
  repo: TournamentRepository,
  entRepo: EntitlementRepository,
  raw: unknown,
  now = Date.now,
): Promise<Result<{ tournamentId: string; code: string }>> {
  const parsed = CreateTournamentInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { name, ownerUserId } = parsed.data;

  const entitlement = await entRepo.getOrCreate(ownerUserId);
  if (!canUseFeature(entitlement.tier, 'create_leagues')) {
    return err('Starting a league needs a paid plan. Joining one is always free.');
  }

  let code = newJoinCode();
  while (await repo.getByCode(code)) code = newJoinCode();

  const tournament: Tournament = {
    id: newId('tourney'),
    code,
    name: name.trim(),
    ownerUserId,
    results: [],
    createdAt: now(),
  };
  await repo.save(tournament);
  return ok({ tournamentId: tournament.id, code });
}

/**
 * Record a finished game against the league it was played in.
 *
 * Team identity comes from the game's team *names*, not its team ids — ids are
 * minted per game, so keying on them would give every team a one-game row and
 * the table would never accumulate. See `tournamentTeamKey`.
 */
export async function recordGameResult(
  repo: TournamentRepository,
  gameRepo: GameRepository,
  input: { tournamentId: string; gameId: string },
): Promise<Result<{ recorded: boolean; reason?: string }>> {
  const tournament = await repo.get(input.tournamentId);
  if (!tournament) return err('League not found.');
  if (tournament.results.some((r) => r.gameId === input.gameId)) {
    // Not an error: the results transition can be replayed, and a league that
    // double-counted a night would be worse than one that ignored the repeat.
    return ok({ recorded: false, reason: 'This game is already in the league table.' });
  }

  const game = await gameRepo.get(input.gameId);
  if (!game) return err('Game not found.');
  const results = await getResults(gameRepo, input.gameId);
  if (!results.ok) return results;

  const teamNames = Object.fromEntries(game.teams.map((t) => [t.id, t.name]));
  tournament.results.push({
    gameId: input.gameId,
    placements: placementsFromScoreboard(results.data.scoreboard, teamNames),
  });
  await repo.save(tournament);
  return ok({ recorded: true });
}

/** A league's public face: its name, its code, and the table. */
export interface StandingsView {
  tournamentId: string;
  code: string;
  name: string;
  gamesPlayed: number;
  standings: Standing[];
}

/**
 * Current standings, resolved by the code the league is shared by — anyone
 * holding it can follow the table without needing to be told an internal id.
 */
export async function getStandingsByCode(
  repo: TournamentRepository,
  code: string,
): Promise<Result<StandingsView>> {
  const tournament = await repo.getByCode(code.toUpperCase());
  if (!tournament) return err('League not found.');
  return ok({
    tournamentId: tournament.id,
    code: tournament.code,
    name: tournament.name,
    gamesPlayed: tournament.results.length,
    standings: aggregateStandings(tournament.results),
  });
}

/** Generate a recap for a finished game from its computed scoreboard. */
export async function generateGameRecap(
  gameRepo: GameRepository,
  input: { gameId: string },
): Promise<Result<{ recap: string }>> {
  const game = await gameRepo.get(input.gameId);
  if (!game) return err('Game not found.');
  const results = await getResults(gameRepo, input.gameId);
  if (!results.ok) return results;
  const teamNames = Object.fromEntries(game.teams.map((t) => [t.id, t.name]));
  const recap = generateRecap({
    scoreboard: results.data.scoreboard,
    teamNames,
    bestMatchTeamId: results.data.scoreboard[0]?.teamId,
  });
  return ok({ recap });
}
