/**
 * Scavenger Hunt scoring.
 *
 * A find scores only once judges have validated it, so the "a team member must
 * be in frame pointing at the item" rule is enforced socially rather than
 * automatically — nothing can verify pointing from pixels.
 *
 * Emits the same `TeamScore` shape as the chase scorer, so the results screen,
 * spectator view and tournament standings work without knowing the mode.
 */

import type { TeamScore } from '../../domain/types.js';
import {
  applyFinalsBonuses,
  applyFouls,
  applyReturnBonus,
  emptyScores,
  totalise,
} from '../../engine/scoring.js';
import { ITEM_POINTS, WILDCARD_MULTIPLIER, type HuntItem } from './items.js';

/** One team's claim on a list item, once judging has resolved it. */
export interface HuntFind {
  teamId: string;
  itemId: string;
  /**
   * Whether judges accepted the photo as a genuine find. Unvalidated claims
   * score nothing rather than being penalised — a wrong guess is not a foul.
   */
  valid: boolean;
}

/** A submitted claim, with everything judging produced about it. */
export interface HuntClaim {
  teamId: string;
  itemId: string;
  /** Validity stars cast on this photo, already weighted by voter role. */
  validityVotes: readonly { stars: number; weight: number }[];
  /** True when someone called `missing_item` on the photo. */
  disputed: boolean;
}

/** Weighted mean validity at or above this counts as a genuine find. */
export const VALIDITY_THRESHOLD = 3;

/**
 * Decide which claims count.
 *
 * An unjudged claim counts. Most games are played among friends with nobody
 * moderating, and a hunt where every find scores zero because no one voted is
 * broken rather than strict. Judging is therefore a veto: a weighted mean below
 * {@link VALIDITY_THRESHOLD}, or a `missing_item` foul, takes the find away.
 */
export function resolveHuntFinds(claims: readonly HuntClaim[]): HuntFind[] {
  return claims.map((claim) => {
    const weight = claim.validityVotes.reduce((sum, v) => sum + v.weight, 0);
    const stars = claim.validityVotes.reduce((sum, v) => sum + v.stars * v.weight, 0);
    const judged = weight > 0 ? stars / weight >= VALIDITY_THRESHOLD : true;
    return { teamId: claim.teamId, itemId: claim.itemId, valid: judged && !claim.disputed };
  });
}

export interface ScavengerScoringInput {
  teamIds: string[];
  /** The list every team was hunting, for rarity lookup. */
  items: readonly HuntItem[];
  /** The wildcard revealed mid-round, if any; it pays double. */
  wildcardItemId?: string;
  finds: readonly HuntFind[];
  /** teamId → number of fouls called on that team's photos. */
  fouls?: Record<string, number>;
  /** teamId → return duration (ms); first team back scores the largest bonus. */
  returnDurations?: Record<string, number>;
  specialWinners?: string[];
  bestMatchTeamId?: string;
}

/**
 * Score a completed hunt. A team scores each item at most once, so submitting
 * several photos of the same item cannot farm points.
 */
export function scoreScavenger(input: ScavengerScoringInput): TeamScore[] {
  const scores = emptyScores(input.teamIds);
  const rarityOf = new Map(input.items.map((i) => [i.id, i.rarity]));

  const counted = new Set<string>();
  for (const find of input.finds) {
    if (!find.valid) continue;
    const key = `${find.teamId}::${find.itemId}`;
    if (counted.has(key)) continue;
    counted.add(key);

    const rarity = rarityOf.get(find.itemId);
    if (!rarity) continue; // a claim against an item not on this hunt's list
    const score = scores.get(find.teamId);
    if (!score) continue;

    const multiplier = find.itemId === input.wildcardItemId ? WILDCARD_MULTIPLIER : 1;
    // Finds land in `location`: it is the "went out and got it" column, and
    // reusing it keeps the results screen's breakdown identical across modes.
    score.location += ITEM_POINTS[rarity] * multiplier;
  }

  applyFouls(scores, input.fouls);
  applyReturnBonus(scores, input.returnDurations);
  applyFinalsBonuses(scores, input.bestMatchTeamId, input.specialWinners);
  return totalise(scores);
}
