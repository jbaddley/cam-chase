import { PRICES_CENTS, type SkuId } from '@photochase/shared';

/**
 * In-app purchases.
 *
 * The app never grants an entitlement. It asks the store to complete a
 * purchase, and the store's server notifies our webhook, which is the only
 * thing that can change what a user owns (see services/api/src/webhook-auth.ts).
 * After a purchase the app simply re-reads `GET /me/entitlement`, so a client
 * that lies about a purchase gains nothing.
 *
 * The store SDK itself is injected. RevenueCat wraps StoreKit 2 and Google Play
 * Billing behind one interface (docs/03), but it needs a native build, so the
 * boundary is what the app depends on and the real implementation is supplied
 * at startup.
 */

/** A purchasable product as the app presents it. */
export interface Product {
  sku: SkuId;
  /** Display price from the store, already localized. */
  priceLabel: string;
  /** True for recurring products, which restore rather than re-purchase. */
  subscription: boolean;
}

/** The outcome of asking the store to buy something. */
export type PurchaseResult =
  | { status: 'purchased'; sku: SkuId }
  | { status: 'cancelled' }
  | { status: 'pending' }; // e.g. awaiting parental approval

/** The native store SDK, injected so the app is testable without a build. */
export interface PurchaseGateway {
  /** Products available to this user, priced by their store front. */
  listProducts(): Promise<Product[]>;
  purchase(sku: SkuId): Promise<PurchaseResult>;
  /** Re-apply purchases already owned; the App Store requires this path. */
  restore(): Promise<void>;
  /**
   * Called when the store's view of what this user owns changes — a renewal, a
   * lapse, a purchase finished on another device, a refund.
   *
   * It carries no entitlement data on purpose. The store is a *notification*
   * here, not a source of truth: what a user owns is decided by the server,
   * which the provider's webhook updates. So the only correct reaction to this
   * signal is to re-read `GET /me/entitlement`, and a client that forged the
   * signal would learn nothing it could not already ask for.
   *
   * Returns an unsubscribe. Optional, because a gateway with no store behind it
   * has nothing to report.
   */
  subscribe?(onChanged: () => void): () => void;
}

/** Products offered in-app, in the order they should be shown. */
export const OFFERED_SKUS: SkuId[] = ['game_pack', 'unlimited_monthly', 'annual', 'lifetime'];

/**
 * Longest SKU first, so a longer name is never swallowed by a shorter one it
 * contains — `game_pack_launch` must not resolve to `game_pack`.
 */
const SKUS_BY_LENGTH: SkuId[] = [...OFFERED_SKUS].sort((a, b) => b.length - a.length);

/**
 * Resolve a store product identifier to the SKU it sells.
 *
 * Identifiers are namespaced per platform — `app.photochase.client.game_pack`
 * on the App Store, plain `game_pack` on Play — so this matches on suffix. An
 * unrecognised identifier returns null rather than guessing: a product our
 * webhook cannot grant is one the app must not offer.
 */
export function skuOf(productIdentifier: string): SkuId | null {
  return SKUS_BY_LENGTH.find((sku) => productIdentifier.endsWith(sku)) ?? null;
}

/**
 * A fallback price label from the list price, for use only before the store
 * responds. Real prices come from the store front, which handles currency,
 * tax display, and regional pricing — never format money for a user from these.
 */
export function listPriceLabel(sku: SkuId): string {
  return `$${(PRICES_CENTS[sku] / 100).toFixed(2)}`;
}

/**
 * Stand-in used until the store SDK is installed. It fails loudly rather than
 * pretending a purchase succeeded, which would show an upgrade the server has
 * not granted.
 */
export const unavailablePurchaseGateway: PurchaseGateway = {
  listProducts: () => Promise.resolve([]),
  purchase: () => Promise.reject(new Error('No purchase gateway configured.')),
  restore: () => Promise.reject(new Error('No purchase gateway configured.')),
};
