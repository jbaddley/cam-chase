/**
 * What a referral actually earns (docs/08-growth-referrals.md).
 *
 * The chase is free; every other mode is bought or earned. Earning one has to
 * be a real win rather than a nag-free trial, so the currency is *credited*
 * referrals — an invitee who installed and played a game through to the end,
 * which the referral engine already refuses to award for an install alone.
 *
 * A mode earned this way is permanent and additive to the tier's own, so it
 * survives a lapsed subscription. That is the point: it was earned, not rented.
 */

import type { GameMode } from '../domain/enums.js';

export interface UnlockRung {
  /** Credited referrals needed to reach this rung. */
  referrals: number;
  mode: GameMode;
}

/**
 * The ladder, cheapest first. Scavenger Hunt at one referral is deliberately
 * reachable — the first unlock has to feel attainable or nobody starts the
 * climb — while Photo Tag, the mode that costs the most to run, sits at five.
 */
export const MODE_UNLOCK_LADDER: readonly UnlockRung[] = [
  { referrals: 1, mode: 'scavenger_hunt' },
  { referrals: 3, mode: 'color_hunt' },
  { referrals: 5, mode: 'photo_tag' },
];

/** Every mode a referrer has earned at this credited-referral count. */
export function modesEarnedAt(creditedReferrals: number): GameMode[] {
  return MODE_UNLOCK_LADDER.filter((rung) => creditedReferrals >= rung.referrals).map((rung) => rung.mode);
}

/** The next rung and how far away it is, or null once the ladder is topped. */
export function nextUnlock(creditedReferrals: number): { mode: GameMode; referralsAway: number } | null {
  const rung = MODE_UNLOCK_LADDER.find((r) => creditedReferrals < r.referrals);
  return rung ? { mode: rung.mode, referralsAway: rung.referrals - creditedReferrals } : null;
}

/**
 * Cosmetic status, the one reward that still means something to a subscriber —
 * they have no use for a mode key or a game credit, but a badge is theirs.
 */
export const FLAIRS = ['scout', 'connector', 'ringleader', 'legend'] as const;
export type Flair = (typeof FLAIRS)[number];

const FLAIR_LADDER: ReadonlyArray<{ referrals: number; flair: Flair }> = [
  { referrals: 1, flair: 'scout' },
  { referrals: 3, flair: 'connector' },
  { referrals: 5, flair: 'ringleader' },
  { referrals: 10, flair: 'legend' },
];

/** The highest flair earned, or null before the first credited referral. */
export function flairFor(creditedReferrals: number): Flair | null {
  let earned: Flair | null = null;
  for (const rung of FLAIR_LADDER) {
    if (creditedReferrals >= rung.referrals) earned = rung.flair;
  }
  return earned;
}
