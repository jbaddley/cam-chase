/**
 * Finals voting: tally best-overall-match and special-category winners from
 * weighted votes (judge/spectator weighting is applied when building the votes
 * via resolveVoteWeight). Feeds computeScoreboard's bestMatch/special bonuses.
 */

import type { Assignment, Vote } from '../domain/types.js';

/** The reserved category id for the best-overall-match vote. */
export const BEST_OVERALL_CATEGORY = 'best_overall_match';

/** A team's ballot entry: the matchup shown so voters judge its best work. */
export interface Finalist {
  teamId: string;
  originalPhotoId: string;
  chasePhotoId: string;
}

/**
 * Each team's strongest matchup to put on the finals ballot: the assignment it
 * submitted that drew the most stars, so a voter is choosing between teams'
 * *best* recreations rather than voting blind. Ties — and an unrated game —
 * fall back to the earliest assignment in the queue, for determinism. A team
 * that submitted nothing has no finalist and is omitted.
 */
export function pickFinalists(assignments: Assignment[], votes: Vote[]): Finalist[] {
  const stars = new Map<string, number>();
  for (const v of votes) stars.set(v.assignmentId, (stars.get(v.assignmentId) ?? 0) + v.stars);

  const best = new Map<string, Assignment>();
  for (const a of assignments) {
    if (a.chasePhotoId === null) continue;
    const cur = best.get(a.chaserTeamId);
    if (!cur) {
      best.set(a.chaserTeamId, a);
      continue;
    }
    const aStars = stars.get(a.id) ?? 0;
    const curStars = stars.get(cur.id) ?? 0;
    if (aStars > curStars || (aStars === curStars && a.order < cur.order)) best.set(a.chaserTeamId, a);
  }

  return [...best.values()]
    .sort((a, b) => a.chaserTeamId.localeCompare(b.chaserTeamId))
    .map((a) => ({ teamId: a.chaserTeamId, originalPhotoId: a.originalPhotoId, chasePhotoId: a.chasePhotoId! }));
}

export interface FinalsVote {
  /** Category id: BEST_OVERALL_CATEGORY, a preset, or a custom category. */
  category: string;
  teamId: string;
  /** Pre-resolved voter weight. */
  weight: number;
}

/**
 * Winner per category by summed weight. Ties break by teamId ascending for
 * determinism. Categories with no votes are omitted.
 */
export function tallyCategoryWinners(votes: FinalsVote[]): Record<string, string> {
  const totals = new Map<string, Map<string, number>>();
  for (const v of votes) {
    if (!totals.has(v.category)) totals.set(v.category, new Map());
    const cat = totals.get(v.category)!;
    cat.set(v.teamId, (cat.get(v.teamId) ?? 0) + v.weight);
  }

  const winners: Record<string, string> = {};
  for (const [category, tally] of totals) {
    let bestTeam: string | null = null;
    let bestScore = -Infinity;
    for (const [teamId, score] of [...tally].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (score > bestScore) {
        bestScore = score;
        bestTeam = teamId;
      }
    }
    if (bestTeam) winners[category] = bestTeam;
  }
  return winners;
}

export interface FinalsOutcome {
  bestMatchTeamId?: string;
  /** One teamId per special category won (repeats allowed). */
  specialWinners: string[];
}

/** Resolve the finals outcome into scoring-engine inputs. */
export function resolveFinals(votes: FinalsVote[]): FinalsOutcome {
  const winners = tallyCategoryWinners(votes);
  const bestMatchTeamId = winners[BEST_OVERALL_CATEGORY];
  const specialWinners = Object.entries(winners)
    .filter(([category]) => category !== BEST_OVERALL_CATEGORY)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, teamId]) => teamId);
  return bestMatchTeamId ? { bestMatchTeamId, specialWinners } : { specialWinners };
}
