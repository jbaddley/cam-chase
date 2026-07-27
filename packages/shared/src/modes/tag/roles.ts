/**
 * Photo Tag roles and targets.
 *
 * Individuals play as teams of one. The model is team-centric throughout
 * (`Membership.teamId`, scoreboards keyed by team), so rather than a parallel
 * player model each person becomes a single-member team and scoring, results
 * and league standings work unchanged.
 */

import { mulberry32, shuffle } from '../../engine/rng.js';
import { haversineMeters } from '../../engine/scoring.js';
import type { GeoPoint } from '../../domain/types.js';

export const TAG_SUB_MODES = ['pure_finder', 'hide_seek', 'dual'] as const;
export type TagSubMode = (typeof TAG_SUB_MODES)[number];

/** Hide & Seek roles. Hidden from everyone until the scatter timer ends. */
export const TAG_ROLES = ['hunter', 'hider'] as const;
export type TagRole = (typeof TAG_ROLES)[number];

export interface TagAssignment {
  /** Hide & Seek only: teamId → role. */
  roles?: Record<string, TagRole>;
  /**
   * Dual only: hunter teamId → the team they hunt. Readable by the hunter
   * alone — the prey is never told who is after them, only that someone is
   * close. See {@link isHunterNearby}.
   */
  targets?: Record<string, string>;
}

/** Roughly a third of players hunt in Hide & Seek, and never fewer than one. */
export function hunterCount(playerCount: number): number {
  return Math.max(1, Math.floor(playerCount / 3));
}

/**
 * Deal roles and targets for a sub-mode, deterministically from the seed.
 *
 * - `pure_finder`: everyone hunts one shared target at a time, so there is
 *   nothing per-player to deal.
 * - `hide_seek`: a minority hunt, the rest hide.
 * - `dual`: everyone hunts exactly one person and is hunted by exactly one,
 *   arranged as a single cycle so nobody hunts themselves and nobody is left
 *   out — a pairing that could otherwise strand a player with no prey.
 */
export function assignTagRoles(input: {
  teamIds: readonly string[];
  subMode: TagSubMode;
  seed: number;
}): TagAssignment {
  const rng = mulberry32(input.seed);
  const order = shuffle([...input.teamIds], rng);

  if (input.subMode === 'hide_seek') {
    const hunters = hunterCount(order.length);
    const roles: Record<string, TagRole> = {};
    order.forEach((teamId, i) => {
      roles[teamId] = i < hunters ? 'hunter' : 'hider';
    });
    return { roles };
  }

  if (input.subMode === 'dual') {
    // A single cycle is the one arrangement that guarantees every player both
    // hunts and is hunted exactly once, with no self-assignment.
    //
    // With exactly two players the cycle is necessarily mutual — your prey is
    // also your hunter — so the "never name the hunter" property is vacuous
    // there. That is inherent to the pairing, not a leak, but it does mean dual
    // only becomes an interesting game from three players up.
    const targets: Record<string, string> = {};
    order.forEach((teamId, i) => {
      targets[teamId] = order[(i + 1) % order.length]!;
    });
    return { targets };
  }

  return {};
}

/** How close a hunter has to be before the prey is warned, in metres. */
export const PROXIMITY_WARNING_M = 50;

/**
 * Whether the prey should be warned that a hunter is close.
 *
 * Deliberately a boolean, not a distance and never a name. Telling the prey who
 * hunts them lets them simply avoid one person — the flaw the brainstorm
 * flagged and never resolved. A coarse "someone is near" keeps the tension
 * without handing over the exploit.
 *
 * Flagged for playtesting: consumer GPS is accurate to ±5–10 m, so a 50 m
 * threshold is a guess that only real devices can validate.
 */
export function isHunterNearby(prey: GeoPoint | undefined, hunter: GeoPoint | undefined): boolean {
  if (!prey || !hunter) return false;
  return haversineMeters(prey, hunter) <= PROXIMITY_WARNING_M;
}
