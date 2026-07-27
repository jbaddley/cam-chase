import { describe, expect, it } from 'vitest';
import {
  generateHuntList,
  itemsForTheme,
  pickWildcard,
  visibleHuntItems,
  HUNT_THEMES,
  type HuntItem,
  type HuntTheme,
} from './items.js';

describe('generateHuntList', () => {
  it('is deterministic for a seed, so every team hunts the same list', () => {
    const a = generateHuntList({ theme: 'city', count: 6, seed: 42 });
    const b = generateHuntList({ theme: 'city', count: 6, seed: 42 });
    expect(a).toEqual(b);
  });

  it('produces a different list for a different seed', () => {
    const a = generateHuntList({ theme: 'city', count: 6, seed: 1 });
    const b = generateHuntList({ theme: 'city', count: 6, seed: 2 });
    expect(a.map((i) => i.id)).not.toEqual(b.map((i) => i.id));
  });

  it('returns the requested count with no duplicates', () => {
    const list = generateHuntList({ theme: 'mixed', count: 10, seed: 7 });
    expect(list).toHaveLength(10);
    expect(new Set(list.map((i) => i.id)).size).toBe(10);
  });

  it('caps rares at about a third, so the hunt stays finishable', () => {
    const list = generateHuntList({ theme: 'mixed', count: 9, seed: 3 });
    const rares = list.filter((i) => i.rarity === 'rare');
    expect(rares.length).toBeLessThanOrEqual(3);
    // ...but a hunt of only commons has no strategy, so expect at least one.
    expect(rares.length).toBeGreaterThan(0);
  });

  it('never asks for more items than the pool holds', () => {
    const pool = itemsForTheme('city');
    const list = generateHuntList({ theme: 'city', count: pool.length + 5, seed: 1 });
    expect(list).toHaveLength(pool.length);
  });

  it.each(HUNT_THEMES)('draws only from the %s pool', (theme: HuntTheme) => {
    const allowed = new Set(itemsForTheme(theme).map((i) => i.id));
    for (const item of generateHuntList({ theme, count: 5, seed: 11 })) {
      expect(allowed.has(item.id)).toBe(true);
    }
  });

  it('draws mixed from more than one pool', () => {
    const cityIds = new Set(itemsForTheme('city').map((i) => i.id));
    const mixed = generateHuntList({ theme: 'mixed', count: 12, seed: 5 });
    expect(mixed.some((i) => !cityIds.has(i.id))).toBe(true);
  });
});

describe('pickWildcard', () => {
  it('picks an item that is not already on the list', () => {
    const list = generateHuntList({ theme: 'city', count: 5, seed: 9 });
    const wildcard = pickWildcard({ theme: 'city', exclude: list, seed: 9 });
    expect(wildcard).not.toBeNull();
    expect(list.some((i) => i.id === wildcard!.id)).toBe(false);
  });

  it('is deterministic for a seed', () => {
    const list = generateHuntList({ theme: 'city', count: 4, seed: 9 });
    const a = pickWildcard({ theme: 'city', exclude: list, seed: 9 });
    const b = pickWildcard({ theme: 'city', exclude: list, seed: 9 });
    expect(a).toEqual(b);
  });

  it('returns null when the pool is exhausted', () => {
    const everything = itemsForTheme('city');
    expect(pickWildcard({ theme: 'city', exclude: everything, seed: 1 })).toBeNull();
  });
});

describe('visibleHuntItems', () => {
  const items: HuntItem[] = [
    { id: 'a', label: 'A', rarity: 'common' },
    { id: 'w', label: 'Wildcard', rarity: 'rare' },
  ];
  const hunt = { items, wildcardItemId: 'w', wildcardRevealAt: 1_000 };

  it('withholds the wildcard before its reveal time', () => {
    expect(visibleHuntItems(hunt, 999).map((i) => i.id)).toEqual(['a']);
  });

  it('shows the wildcard from its reveal time onward', () => {
    expect(visibleHuntItems(hunt, 1_000).map((i) => i.id)).toEqual(['a', 'w']);
    expect(visibleHuntItems(hunt, 5_000).map((i) => i.id)).toEqual(['a', 'w']);
  });

  it('withholds a wildcard that has no reveal time, rather than leaking it', () => {
    expect(visibleHuntItems({ items, wildcardItemId: 'w' }, 9_999).map((i) => i.id)).toEqual(['a']);
  });

  it('shows everything when the hunt has no wildcard', () => {
    expect(visibleHuntItems({ items }, 0)).toHaveLength(2);
  });
});
