/**
 * Pricing and unit economics from docs/03-pricing-monetization.md, encoded as
 * testable functions. All money is in integer US cents to avoid float drift.
 */

export type SkuId = 'game_pack' | 'game_pack_launch' | 'unlimited_monthly' | 'annual' | 'lifetime';

/** List prices in US cents (localized store fronts scale these at runtime). */
export const PRICES_CENTS: Record<SkuId, number> = {
  game_pack: 399,
  game_pack_launch: 299,
  unlimited_monthly: 599,
  annual: 3999,
  lifetime: 2999,
};

/** Sales channels and their effective take. */
export type Channel = 'store_standard' | 'store_small_business' | 'stripe_web';

/** Per-game cost of goods (US cents). AI judging is hard-capped per game. */
export const INFRA_COGS_CENTS = 5;
export const AI_CAP_CENTS = 30;

export function perGameCogsCents(opts: { aiJudging: boolean }): number {
  return INFRA_COGS_CENTS + (opts.aiJudging ? AI_CAP_CENTS : 0);
}

/** Net revenue retained after the channel's cut, in cents. */
export function netRevenueCents(priceCents: number, channel: Channel): number {
  switch (channel) {
    case 'store_standard':
      return Math.floor(priceCents * 0.7);
    case 'store_small_business':
      return Math.floor(priceCents * 0.85);
    case 'stripe_web':
      return priceCents - Math.round(priceCents * 0.029) - 30;
  }
}

export interface MarginResult {
  netCents: number;
  cogsCents: number;
  marginPct: number;
}

/** Margin for a purchase given how many games its buyer plays. */
export function gameMargin(opts: {
  priceCents: number;
  channel: Channel;
  gamesCovered: number;
  aiJudging: boolean;
}): MarginResult {
  const netCents = netRevenueCents(opts.priceCents, opts.channel);
  const cogsCents = opts.gamesCovered * perGameCogsCents({ aiJudging: opts.aiJudging });
  const marginPct = netCents === 0 ? 0 : ((netCents - cogsCents) / netCents) * 100;
  return { netCents, cogsCents, marginPct };
}

/** The overall margin target from the pricing doc. */
export const TARGET_MARGIN_PCT = 60;
