import { describe, expect, it } from 'vitest';
import { DAILY_ITEM_COUNT, dailyHuntList, dailyKey, dailySeed, dailyTheme } from './daily.js';
import { itemsForTheme } from './items.js';

describe('dailyKey', () => {
  it('is the UTC date, so a run belongs to one day everywhere', () => {
    expect(dailyKey(Date.UTC(2026, 6, 27, 13, 30))).toBe('2026-07-27');
  });

  it('groups every moment of a day under one key', () => {
    expect(dailyKey(Date.UTC(2026, 6, 27, 0, 0))).toBe(dailyKey(Date.UTC(2026, 6, 27, 23, 59)));
  });

  it('rolls over at UTC midnight', () => {
    expect(dailyKey(Date.UTC(2026, 6, 27, 23, 59))).not.toBe(dailyKey(Date.UTC(2026, 6, 28, 0, 0)));
  });
});

describe('dailySeed', () => {
  it('is stable for a key, so the list can be regenerated with nothing stored', () => {
    expect(dailySeed('2026-07-27')).toBe(dailySeed('2026-07-27'));
  });

  it('differs day to day', () => {
    expect(dailySeed('2026-07-27')).not.toBe(dailySeed('2026-07-28'));
  });
});

describe('dailyHuntList', () => {
  it('gives everyone the same list on the same day', () => {
    // The whole point: a score is only worth comparing against a shared list.
    expect(dailyHuntList('2026-07-27')).toEqual(dailyHuntList('2026-07-27'));
  });

  it('gives a different list on a different day', () => {
    const today = dailyHuntList('2026-07-27').map((i) => i.id);
    const tomorrow = dailyHuntList('2026-07-28').map((i) => i.id);
    expect(today).not.toEqual(tomorrow);
  });

  it('is short enough to finish on a walk', () => {
    expect(dailyHuntList('2026-07-27')).toHaveLength(DAILY_ITEM_COUNT);
  });

  it('draws only from that day’s theme', () => {
    const key = '2026-07-27';
    const allowed = new Set(itemsForTheme(dailyTheme(key)).map((i) => i.id));
    for (const item of dailyHuntList(key)) expect(allowed.has(item.id)).toBe(true);
  });

  it('rotates the theme, so a week is not the same walk five times', () => {
    const themes = new Set(
      ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'].map(
        dailyTheme,
      ),
    );
    expect(themes.size).toBeGreaterThan(1);
  });
});
