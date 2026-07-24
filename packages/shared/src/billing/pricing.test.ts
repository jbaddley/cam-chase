import { describe, expect, it } from 'vitest';
import {
  gameMargin,
  netRevenueCents,
  perGameCogsCents,
  PRICES_CENTS,
  TARGET_MARGIN_PCT,
} from './pricing.js';

describe('netRevenueCents', () => {
  it('applies the small-business (15%) cut', () => {
    expect(netRevenueCents(399, 'store_small_business')).toBe(339); // floor(399*0.85)
  });

  it('applies the standard (30%) cut', () => {
    expect(netRevenueCents(399, 'store_standard')).toBe(279); // floor(399*0.70)
  });

  it('applies Stripe 2.9% + 30c on web', () => {
    // 599 - round(599*0.029)=17 - 30 = 552
    expect(netRevenueCents(599, 'stripe_web')).toBe(552);
  });
});

describe('perGameCogsCents', () => {
  it('adds the AI cap only when AI judging is on', () => {
    expect(perGameCogsCents({ aiJudging: false })).toBe(5);
    expect(perGameCogsCents({ aiJudging: true })).toBe(35);
  });
});

describe('gameMargin', () => {
  it('game pack at 15% cut clears the 60% target even with AI', () => {
    const m = gameMargin({ priceCents: PRICES_CENTS.game_pack, channel: 'store_small_business', gamesCovered: 2, aiJudging: true });
    expect(m.netCents).toBe(339);
    expect(m.cogsCents).toBe(70);
    expect(m.marginPct).toBeGreaterThan(TARGET_MARGIN_PCT);
  });

  it('game pack still clears 60% at the 30% standard cut', () => {
    const m = gameMargin({ priceCents: PRICES_CENTS.game_pack, channel: 'store_standard', gamesCovered: 2, aiJudging: true });
    expect(m.marginPct).toBeGreaterThan(TARGET_MARGIN_PCT);
  });

  it('monthly subscription at typical usage clears the target', () => {
    const m = gameMargin({ priceCents: PRICES_CENTS.unlimited_monthly, channel: 'store_small_business', gamesCovered: 3, aiJudging: true });
    expect(m.marginPct).toBeGreaterThan(TARGET_MARGIN_PCT);
  });

  it('flags the heavy-usage subscription outlier below target', () => {
    const m = gameMargin({ priceCents: PRICES_CENTS.unlimited_monthly, channel: 'store_small_business', gamesCovered: 10, aiJudging: true });
    expect(m.marginPct).toBeLessThan(TARGET_MARGIN_PCT); // per-account AI caps address this tail
  });
});
