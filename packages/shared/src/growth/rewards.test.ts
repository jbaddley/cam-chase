import { describe, expect, it } from 'vitest';
import { flairFor, modesEarnedAt, nextUnlock, MODE_UNLOCK_LADDER } from './rewards.js';

describe('modesEarnedAt', () => {
  it('earns nothing before the first credited referral', () => {
    expect(modesEarnedAt(0)).toEqual([]);
  });

  it('earns the first rung on the first credited referral', () => {
    expect(modesEarnedAt(1)).toEqual(['scavenger_hunt']);
  });

  it('accumulates rather than replacing, so an unlock is never lost', () => {
    expect(modesEarnedAt(5)).toEqual(['scavenger_hunt', 'color_hunt', 'photo_tag']);
  });

  it('earns everything and no more beyond the top rung', () => {
    expect(modesEarnedAt(500)).toEqual(modesEarnedAt(5));
  });

  it('never offers the free mode as a reward — it is already free', () => {
    expect(MODE_UNLOCK_LADDER.some((rung) => rung.mode === 'photo_chase')).toBe(false);
  });

  it('climbs in order, so a later rung is never cheaper than an earlier one', () => {
    const counts = MODE_UNLOCK_LADDER.map((r) => r.referrals);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  });
});

describe('nextUnlock', () => {
  it('points at the first rung from a standing start', () => {
    expect(nextUnlock(0)).toEqual({ mode: 'scavenger_hunt', referralsAway: 1 });
  });

  it('counts down within a rung', () => {
    expect(nextUnlock(2)).toEqual({ mode: 'color_hunt', referralsAway: 1 });
  });

  it('reports nothing left once the ladder is topped', () => {
    expect(nextUnlock(5)).toBeNull();
  });
});

describe('flairFor', () => {
  it('gives no flair before the first credited referral', () => {
    expect(flairFor(0)).toBeNull();
  });

  it('reports the highest earned, not the first', () => {
    expect(flairFor(4)).toBe('connector');
    expect(flairFor(10)).toBe('legend');
  });

  it('keeps the top flair however far past it a referrer goes', () => {
    expect(flairFor(999)).toBe('legend');
  });

  it('outlasts the mode ladder, so a subscriber still has something to chase', () => {
    // A subscriber owns every mode already; flair is the only reward left.
    expect(flairFor(10)).not.toBe(flairFor(5));
  });
});
