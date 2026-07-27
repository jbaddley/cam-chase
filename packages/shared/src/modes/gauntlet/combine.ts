/**
 * The gauntlet: one session chaining several modes into a single scoreboard.
 *
 * Every mode emits the same `TeamScore`, so combining them is mostly addition —
 * which is exactly why this is worth having. A gauntlet is the payoff for
 * building the modes on one score shape rather than four.
 */

import type { TeamScore } from '../../domain/types.js';
import { tournamentTeamKey, type GamePlacement } from '../../tournament/standings.js';

/** One finished leg, in the form a league already stores its results. */
export type GauntletLeg = readonly GamePlacement[];

/** A team's running total across a gauntlet. */
export interface GauntletStanding {
  /** Stable across legs — the normalised team name; see `tournamentTeamKey`. */
  teamKey: string;
  teamName: string;
  legsPlayed: number;
  total: number;
  /** Per-leg totals in order, so the table can show the shape of the comeback. */
  legTotals: number[];
}

/**
 * Combine finished legs into one table.
 *
 * Identity is the team's *name*, exactly as in league standings: a game's team
 * ids are minted per game, so keying on them would give every team a one-leg
 * row and the gauntlet would never accumulate.
 */
export function combineLegs(legs: readonly GauntletLeg[]): GauntletStanding[] {
  const table = new Map<string, GauntletStanding>();

  legs.forEach((leg, index) => {
    for (const placement of leg) {
      let standing = table.get(placement.teamKey);
      if (!standing) {
        standing = { teamKey: placement.teamKey, teamName: placement.teamName, legsPlayed: 0, total: 0, legTotals: [] };
        table.set(placement.teamKey, standing);
      }
      // The last spelling seen wins, so a recapitalised name shows current.
      standing.teamName = placement.teamName;
      standing.legsPlayed += 1;
      standing.total += placement.gamePoints;
      // Legs a team missed leave a zero, so the columns stay aligned.
      while (standing.legTotals.length < index) standing.legTotals.push(0);
      standing.legTotals[index] = placement.gamePoints;
    }
  });

  const legCount = legs.length;
  for (const standing of table.values()) {
    while (standing.legTotals.length < legCount) standing.legTotals.push(0);
  }

  return [...table.values()].sort(
    (a, b) => b.total - a.total || a.teamKey.localeCompare(b.teamKey),
  );
}

/**
 * The most a trailing team's final-leg score can be scaled by. Deliberately
 * small: a handicap should keep a blowout worth playing, not hand the game to
 * whoever lost the first leg.
 */
export const MAX_CATCH_UP_MULTIPLIER = 1.25;

/**
 * A multiplier for the final leg, from how far a team trails the leader.
 *
 * Scales linearly from 1.0 for the leader up to {@link MAX_CATCH_UP_MULTIPLIER}
 * for a team on nothing. Continuous rather than banded, so nobody gains by
 * losing *more* — a step function would reward tanking a leg to drop a band.
 *
 * This only has meaning in a gauntlet, because a gauntlet is the only place a
 * standing exists before the last round begins. A single game has no midpoint
 * to trail at, which is why the handicap lives here and not in the chase.
 */
export function catchUpMultiplier(teamTotal: number, leaderTotal: number): number {
  if (leaderTotal <= 0 || teamTotal >= leaderTotal) return 1;
  const behind = Math.min(1, Math.max(0, (leaderTotal - teamTotal) / leaderTotal));
  return 1 + behind * (MAX_CATCH_UP_MULTIPLIER - 1);
}

/**
 * Apply the handicap to a final-leg scoreboard, using the standings *before*
 * that leg. Every scored column is scaled together so the breakdown still adds
 * up to the total a player sees.
 */
export function applyCatchUp(
  finalLeg: readonly TeamScore[],
  standingsBefore: readonly GauntletStanding[],
  teamNames: Readonly<Record<string, string>>,
): TeamScore[] {
  const leader = Math.max(0, ...standingsBefore.map((s) => s.total));
  const totalOf = new Map(standingsBefore.map((s) => [s.teamKey, s.total]));

  return finalLeg.map((score) => {
    const key = tournamentTeamKey(teamNames[score.teamId] ?? score.teamId);
    const multiplier = catchUpMultiplier(totalOf.get(key) ?? 0, leader);
    if (multiplier === 1) return score;

    const scale = (n: number) => Math.round(n * multiplier);
    const scaled: TeamScore = {
      teamId: score.teamId,
      location: scale(score.location),
      pose: scale(score.pose),
      angle: scale(score.angle),
      timeBonus: scale(score.timeBonus),
      bestMatchBonus: scale(score.bestMatchBonus),
      specialBonus: scale(score.specialBonus),
      // The penalty scales too, or a trailing team would be fined less for the
      // same foul — a handicap should not also be an amnesty.
      foulPenalty: scale(score.foulPenalty),
      total: 0,
    };
    scaled.total =
      scaled.location +
      scaled.pose +
      scaled.angle +
      scaled.timeBonus +
      scaled.bestMatchBonus +
      scaled.specialBonus -
      scaled.foulPenalty;
    return scaled;
  });
}
