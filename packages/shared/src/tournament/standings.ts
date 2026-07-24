import type { TeamScore } from '../domain/types.js';

/**
 * Tournament / league standings (docs/09 Phase 4): aggregate per-game results
 * into a season table. Teams are identified by a stable key that persists
 * across games in the tournament.
 */

/** Points awarded by finishing placement in a single game (index 0 = winner). */
export const PLACEMENT_POINTS: readonly number[] = [10, 6, 4, 3, 2, 1];

export interface GamePlacement {
  teamKey: string;
  gamePoints: number;
}

export interface GameResult {
  gameId: string;
  /** Teams ordered best-first (as produced by the scoreboard). */
  placements: GamePlacement[];
}

/** Build placements from a game's final scoreboard (already sorted best-first). */
export function placementsFromScoreboard(scoreboard: TeamScore[]): GamePlacement[] {
  return scoreboard.map((s) => ({ teamKey: s.teamId, gamePoints: s.total }));
}

export interface Standing {
  teamKey: string;
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
  const ensure = (teamKey: string): Standing => {
    let s = table.get(teamKey);
    if (!s) {
      s = { teamKey, gamesPlayed: 0, wins: 0, placementPoints: 0, totalGamePoints: 0 };
      table.set(teamKey, s);
    }
    return s;
  };

  for (const result of results) {
    result.placements.forEach((placement, rank) => {
      const s = ensure(placement.teamKey);
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
