/**
 * Photo Tag scoring.
 *
 * A catch only scores once the *target* has confirmed it. Doc 07 allows face
 * detection and forbids face recognition, so nothing can answer "is this
 * person X" — peer confirmation is not a fallback, it is the only route
 * consistent with our own privacy stance.
 *
 * Emits the same `TeamScore` shape as every other mode.
 */

import type { TeamScore } from '../../domain/types.js';
import { applyFinalsBonuses, applyFouls, emptyScores, totalise } from '../../engine/scoring.js';
import type { TagRole, TagSubMode } from './roles.js';

/** Points for a confirmed catch. */
export const CATCH_POINTS = 50;

/**
 * Hide & Seek: points for a hider who photographs their hunter first. The
 * counter is the distinctive mechanic of the sub-mode and the reason it earns
 * its extra complexity — a hider is not merely running away.
 */
export const COUNTER_POINTS = 30;

/** Points for surviving the round uncaught. */
export const SURVIVAL_POINTS = 25;

/** How a catch claim stands once the target — or the host — has ruled on it. */
export const CATCH_STATUSES = ['pending', 'confirmed', 'disputed', 'overruled'] as const;
export type CatchStatus = (typeof CATCH_STATUSES)[number];

export interface CatchRecord {
  id: string;
  hunterTeamId: string;
  targetTeamId: string;
  photoId: string;
  claimedAt: number;
  status: CatchStatus;
}

export interface TagScoringInput {
  teamIds: string[];
  subMode: TagSubMode;
  catches: readonly CatchRecord[];
  /** Hide & Seek roles, for the counter rule. */
  roles?: Readonly<Record<string, TagRole>>;
  /** Dual targets: a catch only scores against your own assigned prey. */
  targets?: Readonly<Record<string, string>>;
  fouls?: Record<string, number>;
  specialWinners?: string[];
  bestMatchTeamId?: string;
}

/** Only a confirmed claim counts. Pending, disputed and overruled all score 0. */
const isCounted = (record: CatchRecord): boolean => record.status === 'confirmed';

/**
 * Score a finished tag round.
 *
 * A hunter scores each target at most once — catching the same person twice is
 * the same achievement — and survival pays only to a team nobody confirmably
 * caught.
 */
export function scoreTag(input: TagScoringInput): TeamScore[] {
  const scores = emptyScores(input.teamIds);

  /**
   * Order by claim time, falling back to submission order.
   *
   * Timestamps alone are not enough: two claims can land in the same
   * millisecond, and "who got there first" would then depend on nothing. The
   * array is append-ordered, so its index is the tiebreak — and it decides the
   * counter, which is the one place ordering changes the score.
   */
  const ordered = input.catches
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => isCounted(record))
    .sort((a, b) => a.record.claimedAt - b.record.claimedAt || a.index - b.index);

  const rankOf = new Map(ordered.map(({ record }, rank) => [record.id, rank]));

  /** The earliest confirmed catch of `target` by `hunter`, if any. */
  const firstCatch = (hunterTeamId: string, targetTeamId: string): CatchRecord | undefined =>
    ordered.find(({ record }) => record.hunterTeamId === hunterTeamId && record.targetTeamId === targetTeamId)?.record;

  const paid = new Set<string>();
  const caught = new Set<string>();

  for (const { record } of ordered) {
    // In dual play a catch only pays against the prey you were assigned; the
    // point of the mode is your own chase, not opportunism.
    if (input.subMode === 'dual' && input.targets?.[record.hunterTeamId] !== record.targetTeamId) continue;

    // Hide & Seek: a hider who photographed their hunter first blocks the
    // score. That is the counter, and it has to be checked before paying out.
    if (input.subMode === 'hide_seek') {
      const hunterIsHunter = input.roles?.[record.hunterTeamId] === 'hunter';
      const countered = firstCatch(record.targetTeamId, record.hunterTeamId);
      if (hunterIsHunter && countered && rankOf.get(countered.id)! < rankOf.get(record.id)!) {
        const counterer = scores.get(record.targetTeamId);
        if (counterer) counterer.pose += COUNTER_POINTS;
        continue;
      }
      // A hider photographing a hider is not a catch in this sub-mode.
      if (!hunterIsHunter && input.roles?.[record.targetTeamId] !== 'hunter') continue;
    }

    const key = `${record.hunterTeamId}::${record.targetTeamId}`;
    if (paid.has(key)) continue;
    paid.add(key);
    caught.add(record.targetTeamId);

    const hunter = scores.get(record.hunterTeamId);
    // Catches land in `location` — the mode's main scoring column, matching how
    // the other modes use it, so the results breakdown stays aligned.
    if (hunter) hunter.location += CATCH_POINTS;
  }

  for (const teamId of input.teamIds) {
    if (!caught.has(teamId)) scores.get(teamId)!.pose += SURVIVAL_POINTS;
  }

  applyFouls(scores, input.fouls);
  applyFinalsBonuses(scores, input.bestMatchTeamId, input.specialWinners);
  return totalise(scores);
}
