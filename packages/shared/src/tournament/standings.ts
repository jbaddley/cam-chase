import type { TeamScore } from '../domain/types.js';

/**
 * Tournament / league standings (docs/09 Phase 4): aggregate per-game results
 * into a season table. Teams are identified by a stable key that persists
 * across games in the tournament.
 */

/** Points awarded by finishing placement in a single game (index 0 = winner). */
export const PLACEMENT_POINTS: readonly number[] = [10, 6, 4, 3, 2, 1];

export interface GamePlacement {
  /** Stable across games — see {@link tournamentTeamKey}. */
  teamKey: string;
  /** The name as typed in that game, for display. */
  teamName: string;
  gamePoints: number;
}

export interface GameResult {
  gameId: string;
  /** Teams ordered best-first (as produced by the scoreboard). */
  placements: GamePlacement[];
}

/**
 * The identity a team keeps across a league season.
 *
 * A game's `teamId` is minted per game, so keying standings on it would give
 * every team one row with a single game played — the table would never
 * accumulate. The only thing a group actually carries from week to week is what
 * they call themselves, so the name is the key, normalised so "The Reds",
 * "the reds" and "The  Reds" are one team.
 *
 * The trade is deliberate: two different groups picking the same name in one
 * league merge, and a team that renames itself starts over. Both are visible to
 * the players and fixable by them, which a silently non-accumulating table is
 * not.
 */
export function tournamentTeamKey(teamName: string): string {
  return teamName.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Build placements from a game's final scoreboard (already sorted best-first).
 * `teamNames` maps that game's team ids to their names, which is where the
 * season-stable key comes from.
 */
export function placementsFromScoreboard(
  scoreboard: TeamScore[],
  teamNames: Readonly<Record<string, string>>,
): GamePlacement[] {
  return scoreboard.map((s) => {
    const teamName = teamNames[s.teamId] ?? s.teamId;
    return { teamKey: tournamentTeamKey(teamName), teamName, gamePoints: s.total };
  });
}

export interface Standing {
  teamKey: string;
  /** The most recent name this team played under, for display. */
  teamName: string;
  gamesPlayed: number;
  wins: number;
  placementPoints: number;
  totalGamePoints: number;
}

/**
 * Aggregate game results into standings, sorted by placement points, then total
 * game points, then teamKey for deterministic tie-breaking.
 */
export function aggregateStandings(results: GameResult[]): Standing[] {
  const table = new Map<string, Standing>();
  const ensure = (teamKey: string, teamName: string): Standing => {
    let s = table.get(teamKey);
    if (!s) {
      s = { teamKey, teamName, gamesPlayed: 0, wins: 0, placementPoints: 0, totalGamePoints: 0 };
      table.set(teamKey, s);
    }
    return s;
  };

  for (const result of results) {
    result.placements.forEach((placement, rank) => {
      const s = ensure(placement.teamKey, placement.teamName);
      // Results arrive oldest-first, so the last spelling seen is the current
      // one — a team that recapitalises its name shows the new version.
      s.teamName = placement.teamName;
      s.gamesPlayed += 1;
      if (rank === 0) s.wins += 1;
      s.placementPoints += PLACEMENT_POINTS[rank] ?? 0;
      s.totalGamePoints += placement.gamePoints;
    });
  }

  return [...table.values()].sort(
    (a, b) =>
      b.placementPoints - a.placementPoints ||
      b.totalGamePoints - a.totalGamePoints ||
      a.teamKey.localeCompare(b.teamKey),
  );
}
