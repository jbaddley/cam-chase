import type { GameConfig } from '../config/schema.js';
import { validateConfigForTier } from '../config/schema.js';
import type { GameMode, Tier } from '../domain/enums.js';
import { TIER_LIMITS } from '../config/tiers.js';

/** A user's current monetization entitlement. */
export interface Entitlement {
  userId: string;
  tier: Tier;
  /** Remaining one-time game credits (game_pack tier). */
  gameCredits: number;
  /** True while an active subscription grants unlimited games. */
  subscriptionActive: boolean;
  /** Epoch ms the subscription lapses, if any. */
  subscriptionExpiresAt?: number;
  /**
   * A one-off purchase that never lapses. Kept separate from
   * `subscriptionActive` rather than modelled as a subscription with a distant
   * expiry, because a far-future date is a lie that eventually comes true — and
   * because the two are cancelled by different events.
   */
  lifetime?: boolean;
  /**
   * Modes earned rather than bought — a referral reward. Additive to the tier's
   * own `allowedModes`, and permanent once granted.
   */
  unlockedModes?: GameMode[];
}

export type Feature =
  | 'ai_judging'
  | 'geofencing'
  | 'special_categories'
  | 'random_game_type'
  | 'judge_weight_over_1'
  | 'up_to_6_teams'
  | 'create_leagues';

export function freeEntitlement(userId: string): Entitlement {
  return { userId, tier: 'free', gameCredits: 0, subscriptionActive: false };
}

/** Whether a tier unlocks a given advanced feature. */
export function canUseFeature(tier: Tier, feature: Feature): boolean {
  const limits = TIER_LIMITS[tier];
  switch (feature) {
    case 'ai_judging':
      return limits.allowAiJudging;
    case 'geofencing':
      return limits.allowGeofencing;
    case 'special_categories':
      return limits.allowSpecialCategories;
    case 'random_game_type':
      return limits.allowedGameTypes.includes('random');
    case 'judge_weight_over_1':
      return limits.maxJudgeWeight > 1;
    case 'up_to_6_teams':
      return limits.maxTeams > 2;
    case 'create_leagues':
      return limits.allowLeagues;
  }
}

/** Validate that an entitlement's tier permits a proposed game config. */
export function canHostConfig(entitlement: Entitlement, config: GameConfig): { ok: boolean; errors: string[] } {
  return validateConfigForTier(config, entitlement.tier, entitlement.unlockedModes ?? []);
}

/** Every mode this user may host: the tier's, plus anything they have earned. */
export function availableModes(entitlement: Entitlement): GameMode[] {
  const fromTier = TIER_LIMITS[entitlement.tier].allowedModes;
  return [...new Set([...fromTier, ...(entitlement.unlockedModes ?? [])])];
}

/**
 * Permanently grant earned modes. Additive and idempotent: an unlock survives a
 * lapsed subscription and a re-grant, because it was earned rather than rented.
 * Modes the tier already covers are still recorded — the tier can go away.
 */
export function grantModes(entitlement: Entitlement, modes: readonly GameMode[]): Entitlement {
  const merged = [...new Set([...(entitlement.unlockedModes ?? []), ...modes])];
  if (merged.length === (entitlement.unlockedModes ?? []).length) return entitlement;
  return { ...entitlement, unlockedModes: merged };
}

/** Whether the entitlement currently permits starting a new game. */
export function canStartGame(entitlement: Entitlement): { ok: boolean; reason?: string } {
  if (entitlement.subscriptionActive) return { ok: true };
  // Free tier grants unlimited basic games.
  if (TIER_LIMITS[entitlement.tier].gamesGranted === 'unlimited') return { ok: true };
  if (entitlement.gameCredits > 0) return { ok: true };
  return { ok: false, reason: 'No game credits remaining. Buy a game pack or subscribe.' };
}

/** Consume one game credit when starting a game (no-op for unlimited tiers). */
export function consumeGameCredit(entitlement: Entitlement): Entitlement {
  const check = canStartGame(entitlement);
  if (!check.ok) throw new Error(check.reason);
  if (entitlement.subscriptionActive) return entitlement;
  if (TIER_LIMITS[entitlement.tier].gamesGranted === 'unlimited') return entitlement;
  return { ...entitlement, gameCredits: entitlement.gameCredits - 1 };
}

/** Return a consumed credit (game abandoned in lobby). */
export function refundGameCredit(entitlement: Entitlement): Entitlement {
  if (entitlement.subscriptionActive) return entitlement;
  if (TIER_LIMITS[entitlement.tier].gamesGranted === 'unlimited') return entitlement;
  return { ...entitlement, gameCredits: entitlement.gameCredits + 1 };
}

/** Normalized store/webhook events (RevenueCat/Stripe shapes map onto these). */
export type PurchaseEvent =
  | { type: 'game_pack_purchased'; credits: number }
  | { type: 'game_pack_refunded'; credits: number }
  | { type: 'subscription_started'; expiresAt: number }
  | { type: 'subscription_renewed'; expiresAt: number }
  | { type: 'subscription_cancelled' }
  | { type: 'subscription_expired' }
  | { type: 'lifetime_purchased' }
  /** Refunds and chargebacks revoke it; nothing else does. */
  | { type: 'lifetime_revoked' };

/** Resolve the effective tier from credit/subscription state. */
function resolveTier(entitlement: Entitlement): Tier {
  if (entitlement.lifetime === true) return 'unlimited';
  if (entitlement.subscriptionActive) return 'unlimited';
  if (entitlement.gameCredits > 0) return 'game_pack';
  return 'free';
}

/** Apply a purchase/webhook event to an entitlement (pure reducer). */
export function applyPurchaseEvent(entitlement: Entitlement, event: PurchaseEvent): Entitlement {
  const next: Entitlement = { ...entitlement };
  switch (event.type) {
    case 'game_pack_purchased':
      next.gameCredits += event.credits;
      break;
    case 'game_pack_refunded':
      next.gameCredits = Math.max(0, next.gameCredits - event.credits);
      break;
    case 'subscription_started':
    case 'subscription_renewed':
      next.subscriptionActive = true;
      next.subscriptionExpiresAt = event.expiresAt;
      break;
    case 'subscription_cancelled':
    case 'subscription_expired':
      next.subscriptionActive = false;
      break;
    case 'lifetime_purchased':
      next.lifetime = true;
      break;
    case 'lifetime_revoked':
      next.lifetime = false;
      break;
  }
  next.tier = resolveTier(next);
  return next;
}
