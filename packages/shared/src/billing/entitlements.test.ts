import { describe, expect, it } from 'vitest';
import { FREE_CONFIG, DEFAULT_CONFIG } from '../config/schema.js';
import {
  applyPurchaseEvent,
  availableModes,
  canHostConfig,
  canStartGame,
  canUseFeature,
  consumeGameCredit,
  freeEntitlement,
  grantModes,
  refundGameCredit,
  type Entitlement,
} from './entitlements.js';

describe('canUseFeature', () => {
  it('locks advanced features on free, unlocks on paid', () => {
    for (const f of ['ai_judging', 'geofencing', 'special_categories', 'random_game_type', 'judge_weight_over_1', 'up_to_6_teams'] as const) {
      expect(canUseFeature('free', f)).toBe(false);
      expect(canUseFeature('game_pack', f)).toBe(true);
      expect(canUseFeature('unlimited', f)).toBe(true);
    }
  });
});

describe('canHostConfig', () => {
  it('accepts the free config on free and a full config on paid', () => {
    expect(canHostConfig(freeEntitlement('u'), FREE_CONFIG).ok).toBe(true);
    const paid: Entitlement = { userId: 'u', tier: 'game_pack', gameCredits: 1, subscriptionActive: false };
    expect(canHostConfig(paid, { ...DEFAULT_CONFIG, aiJudging: true }).ok).toBe(true);
  });
});

describe('game credits', () => {
  it('free tier can always start (unlimited basic games)', () => {
    const ent = freeEntitlement('u');
    expect(canStartGame(ent).ok).toBe(true);
    expect(consumeGameCredit(ent)).toEqual(ent); // no-op
  });

  it('game_pack consumes and refunds credits', () => {
    let ent: Entitlement = { userId: 'u', tier: 'game_pack', gameCredits: 2, subscriptionActive: false };
    ent = consumeGameCredit(ent);
    expect(ent.gameCredits).toBe(1);
    ent = refundGameCredit(ent);
    expect(ent.gameCredits).toBe(2);
  });

  it('game_pack with no credits cannot start', () => {
    const ent: Entitlement = { userId: 'u', tier: 'game_pack', gameCredits: 0, subscriptionActive: false };
    expect(canStartGame(ent).ok).toBe(false);
    expect(() => consumeGameCredit(ent)).toThrow();
  });

  it('subscription is unlimited and unaffected by consume/refund', () => {
    const ent: Entitlement = { userId: 'u', tier: 'unlimited', gameCredits: 0, subscriptionActive: true };
    expect(canStartGame(ent).ok).toBe(true);
    expect(consumeGameCredit(ent)).toEqual(ent);
    expect(refundGameCredit(ent)).toEqual(ent);
  });
});

describe('applyPurchaseEvent', () => {
  it('game pack purchase promotes free → game_pack and adds credits', () => {
    const ent = applyPurchaseEvent(freeEntitlement('u'), { type: 'game_pack_purchased', credits: 2 });
    expect(ent.tier).toBe('game_pack');
    expect(ent.gameCredits).toBe(2);
  });

  it('subscription lifecycle flips tier to unlimited and back', () => {
    let ent = applyPurchaseEvent(freeEntitlement('u'), { type: 'subscription_started', expiresAt: 1000 });
    expect(ent.tier).toBe('unlimited');
    expect(ent.subscriptionActive).toBe(true);
    ent = applyPurchaseEvent(ent, { type: 'subscription_expired' });
    expect(ent.subscriptionActive).toBe(false);
    expect(ent.tier).toBe('free');
  });

  it('refund cannot drive credits negative', () => {
    const ent = applyPurchaseEvent(freeEntitlement('u'), { type: 'game_pack_refunded', credits: 5 });
    expect(ent.gameCredits).toBe(0);
    expect(ent.tier).toBe('free');
  });
});

describe('mode entitlement', () => {
  const free = (overrides: Partial<Entitlement> = {}): Entitlement => ({
    ...freeEntitlement('u1'),
    ...overrides,
  });

  it('gives the free tier the chase only', () => {
    expect(availableModes(free())).toEqual(['photo_chase']);
  });

  it('rejects hosting a mode outside the tier', () => {
    const result = canHostConfig(free(), { ...FREE_CONFIG, mode: 'scavenger_hunt' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/does not include the "scavenger_hunt" mode/);
  });

  it('honours a mode earned outside the tier', () => {
    // Earned by referral: additive to the tier, and permanent.
    const earned = free({ unlockedModes: ['scavenger_hunt'] });
    expect(availableModes(earned)).toEqual(['photo_chase', 'scavenger_hunt']);
    expect(canHostConfig(earned, { ...FREE_CONFIG, mode: 'scavenger_hunt' }).ok).toBe(true);
  });

  it('does not let an earned mode unlock a different one', () => {
    const earned = free({ unlockedModes: ['scavenger_hunt'] });
    expect(canHostConfig(earned, { ...FREE_CONFIG, mode: 'photo_tag' }).ok).toBe(false);
  });

  it('grants an earned mode additively', () => {
    const granted = grantModes(free({ unlockedModes: ['scavenger_hunt'] }), ['color_hunt']);
    expect(granted.unlockedModes).toEqual(['scavenger_hunt', 'color_hunt']);
  });

  it('is idempotent, so re-granting never duplicates or churns the record', () => {
    const once = grantModes(free(), ['scavenger_hunt']);
    expect(grantModes(once, ['scavenger_hunt'])).toBe(once);
  });

  it('keeps an earned mode after a subscription lapses', () => {
    // The whole point of earning one: it is owned, not rented.
    const subscriber = grantModes(free({ tier: 'unlimited', subscriptionActive: true }), ['photo_tag']);
    const lapsed = applyPurchaseEvent(subscriber, { type: 'subscription_expired' });
    expect(lapsed.tier).toBe('free');
    expect(availableModes(lapsed)).toContain('photo_tag');
  });

  it('gives paid tiers every mode', () => {
    const paid = free({ tier: 'unlimited', subscriptionActive: true });
    expect(availableModes(paid)).toContain('photo_tag');
    expect(canHostConfig(paid, { ...DEFAULT_CONFIG, mode: 'color_hunt' }).ok).toBe(true);
  });

  it('treats a config with no mode as a chase', () => {
    const legacy = { ...FREE_CONFIG, mode: undefined as never };
    expect(canHostConfig(free(), legacy).ok).toBe(true);
  });
});
