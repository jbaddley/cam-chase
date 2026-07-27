/**
 * Scavenger Hunt item lists.
 *
 * Every team plays the same list, so generation is deterministic from the
 * game's seed — the same seed always yields the same hunt, which is what makes
 * a game reproducible in tests and fair between teams.
 */

import { mulberry32, shuffle } from '../../engine/rng.js';

/** Themes a host can pick; `mixed` draws from every pool. */
export const HUNT_THEMES = ['mixed', 'outdoors', 'city', 'household', 'silly'] as const;
export type HuntTheme = (typeof HUNT_THEMES)[number];

/**
 * Rare items are harder to find, so they pay more. The split is what gives a
 * hunt its strategy: sweep the commons, or spend the clock chasing a rare one.
 */
export type Rarity = 'common' | 'rare';

export interface HuntItem {
  id: string;
  label: string;
  rarity: Rarity;
}

/** Points a validated find is worth, before bonuses and penalties. */
export const ITEM_POINTS: Record<Rarity, number> = { common: 10, rare: 25 };

/** A wildcard revealed mid-round pays double, to reward held-back time. */
export const WILDCARD_MULTIPLIER = 2;

const POOLS: Record<Exclude<HuntTheme, 'mixed'>, HuntItem[]> = {
  outdoors: [
    { id: 'leaf', label: 'A leaf bigger than your hand', rarity: 'common' },
    { id: 'water', label: 'Running water', rarity: 'common' },
    { id: 'animal_track', label: 'An animal track', rarity: 'rare' },
    { id: 'tree_face', label: 'A tree that looks like a face', rarity: 'rare' },
    { id: 'flower', label: 'A flower in bloom', rarity: 'common' },
    { id: 'something_climbable', label: 'Something you could climb', rarity: 'common' },
    { id: 'bird', label: 'A bird, mid-air', rarity: 'rare' },
    { id: 'shadow_shape', label: 'A shadow shaped like something else', rarity: 'rare' },
  ],
  city: [
    { id: 'street_sign', label: 'A street sign', rarity: 'common' },
    { id: 'bicycle', label: 'A parked bicycle', rarity: 'common' },
    { id: 'mural', label: 'A mural or street art', rarity: 'rare' },
    { id: 'clock', label: 'A public clock', rarity: 'rare' },
    { id: 'red_door', label: 'A red door', rarity: 'common' },
    { id: 'number_seven', label: 'The number 7', rarity: 'common' },
    { id: 'statue', label: 'A statue', rarity: 'rare' },
    { id: 'reflection', label: 'Your team reflected in glass', rarity: 'common' },
  ],
  household: [
    { id: 'spatula', label: 'A spatula', rarity: 'common' },
    { id: 'odd_sock', label: 'An odd sock', rarity: 'common' },
    { id: 'expired', label: 'Something past its use-by date', rarity: 'rare' },
    { id: 'board_game', label: 'A board game', rarity: 'common' },
    { id: 'houseplant', label: 'A houseplant that needs watering', rarity: 'common' },
    { id: 'old_photo', label: 'A photo taken before you were born', rarity: 'rare' },
    { id: 'handwriting', label: 'Something handwritten', rarity: 'common' },
    { id: 'broken', label: 'Something broken nobody has fixed', rarity: 'rare' },
  ],
  silly: [
    { id: 'terrible_hat', label: 'The worst hat available', rarity: 'common' },
    { id: 'human_pyramid', label: 'A two-person pyramid', rarity: 'rare' },
    { id: 'looks_like_dog', label: 'Something shaped like a dog', rarity: 'rare' },
    { id: 'synchronised', label: 'Your whole team mid-jump', rarity: 'rare' },
    { id: 'upside_down', label: 'Something upside down', rarity: 'common' },
    { id: 'tiny', label: 'The smallest thing you can find', rarity: 'common' },
    { id: 'stack', label: 'Five things stacked up', rarity: 'common' },
    { id: 'disguise', label: 'A convincing disguise', rarity: 'rare' },
  ],
};

/** Every item across every pool, for the `mixed` theme. */
function allItems(): HuntItem[] {
  return Object.values(POOLS).flat();
}

export function itemsForTheme(theme: HuntTheme): HuntItem[] {
  return theme === 'mixed' ? allItems() : POOLS[theme];
}

/**
 * Pick `count` items for a hunt, deterministically for a given seed.
 *
 * Rare items are capped at roughly a third of the list: a hunt that is mostly
 * rares is one nobody finishes, which reads as unfair rather than hard.
 */
export function generateHuntList(input: {
  theme: HuntTheme;
  count: number;
  seed: number;
}): HuntItem[] {
  const pool = itemsForTheme(input.theme);
  const rng = mulberry32(input.seed);

  const commons = shuffle(pool.filter((i) => i.rarity === 'common'), rng);
  const rares = shuffle(pool.filter((i) => i.rarity === 'rare'), rng);

  const count = Math.min(input.count, pool.length);
  const rareTarget = Math.min(rares.length, Math.floor(count / 3));

  const picked = [...rares.slice(0, rareTarget), ...commons.slice(0, count - rareTarget)];
  // Top up from whatever remains if one bucket ran dry.
  if (picked.length < count) {
    const used = new Set(picked.map((i) => i.id));
    picked.push(...pool.filter((i) => !used.has(i.id)).slice(0, count - picked.length));
  }
  return shuffle(picked, rng);
}

/** The shape of a game's hunt that visibility depends on. */
export interface HuntVisibility {
  items: readonly HuntItem[];
  wildcardItemId?: string;
  /** Epoch ms the wildcard becomes visible. Absent means never revealed. */
  wildcardRevealAt?: number;
}

/**
 * The items a team may see right now. The wildcard is stored on the list from
 * the start — scoring needs its rarity either way — but it stays hidden until
 * its reveal time, which is the whole point of it: a mid-round jolt that pulls
 * everyone back to their phone.
 */
export function visibleHuntItems(hunt: HuntVisibility, now: number): HuntItem[] {
  const revealed = hunt.wildcardRevealAt !== undefined && now >= hunt.wildcardRevealAt;
  if (hunt.wildcardItemId === undefined || revealed) return [...hunt.items];
  return hunt.items.filter((i) => i.id !== hunt.wildcardItemId);
}

/**
 * Pick one item that is not already on the list, to be revealed mid-round.
 * Returns null when the pool is exhausted — a hunt simply has no wildcard then.
 */
export function pickWildcard(input: {
  theme: HuntTheme;
  exclude: readonly HuntItem[];
  seed: number;
}): HuntItem | null {
  const used = new Set(input.exclude.map((i) => i.id));
  const remaining = itemsForTheme(input.theme).filter((i) => !used.has(i.id));
  if (remaining.length === 0) return null;
  // Offset the seed so the wildcard is not simply the next list item.
  return shuffle(remaining, mulberry32(input.seed ^ 0x9e3779b9))[0] ?? null;
}
