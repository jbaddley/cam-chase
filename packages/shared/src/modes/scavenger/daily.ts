/**
 * The solo daily hunt: a single-player scavenger run against a date-seeded
 * list, with no lobby.
 *
 * It exists for the moment someone opens the app and nobody else is around —
 * the failure state every party game has. Everyone in the world gets the same
 * list on the same day, which is what makes a score worth comparing and a
 * streak worth keeping.
 */

import { generateHuntList, type HuntItem, type HuntTheme } from './items.js';

/** How many items a daily run is worth. Short enough to finish on a walk. */
export const DAILY_ITEM_COUNT = 6;

/** The UTC date key a run belongs to. One run per person per key. */
export function dailyKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * A seed derived from the date alone, so the list is identical worldwide and
 * reproducible from the key — no stored state needed to regenerate it.
 */
export function dailySeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The theme rotates by day, so a week does not feel like the same walk. */
const ROTATION: readonly HuntTheme[] = ['mixed', 'outdoors', 'city', 'household', 'silly'];

export function dailyTheme(key: string): HuntTheme {
  return ROTATION[dailySeed(key) % ROTATION.length]!;
}

/** Today's list. Same for everyone, derived from the date and nothing else. */
export function dailyHuntList(key: string): HuntItem[] {
  return generateHuntList({ theme: dailyTheme(key), count: DAILY_ITEM_COUNT, seed: dailySeed(key) });
}
