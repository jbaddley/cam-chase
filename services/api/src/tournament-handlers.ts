import {
  aggregateStandings,
  generateRecap,
  placementsFromScoreboard,
  type Standing,
  type TeamScore,
} from '@photochase/shared';
import { getResults, type Result } from './handlers.js';
import { newId } from './ids.js';
import type { GameRepository } from './repository.js';
import type { TournamentRepository } from './tournament-repo.js';

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const err = (error: string): Result<never> => ({ ok: false, error });

/** Create a tournament / league season. */
export async function createTournament(
  repo: TournamentRepository,
  input: { name: string },
): Promise<Result<{ tournamentId: string }>> {
  if (!input.name?.trim()) return err('Tournament name is required.');
  const id = newId('tourney');
  await repo.save({ id, name: input.name, results: [] });
  return ok({ tournamentId: id });
}

/** Record a finished game's scoreboard as a tournament result. */
export async function recordGameResult(
  repo: TournamentRepository,
  input: { tournamentId: string; gameId: string; scoreboard: TeamScore[] },
): Promise<Result<{ recorded: boolean }>> {
  const tournament = await repo.get(input.tournamentId);
  if (!tournament) return err('Tournament not found.');
  if (tournament.results.some((r) => r.gameId === input.gameId)) {
    return err('This game is already recorded in the tournament.');
  }
  tournament.results.push({ gameId: input.gameId, placements: placementsFromScoreboard(input.scoreboard) });
  await repo.save(tournament);
  return ok({ recorded: true });
}

/** Current standings for a tournament. */
export async function getStandings(
  repo: TournamentRepository,
  tournamentId: string,
): Promise<Result<Standing[]>> {
  const tournament = await repo.get(tournamentId);
  if (!tournament) return err('Tournament not found.');
  return ok(aggregateStandings(tournament.results));
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
