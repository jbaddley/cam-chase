import Purchases, {
  PRODUCT_CATEGORY,
  PURCHASES_ERROR_CODE,
  type PurchasesError,
  type PurchasesPackage,
} from 'react-native-purchases';
import type { SkuId } from '@photochase/shared';
import { OFFERED_SKUS, skuOf, type Product, type PurchaseGateway, type PurchaseResult } from '../purchases.js';

/**
 * The real store boundary, via RevenueCat — one SDK over StoreKit 2 and Google
 * Play Billing (docs/03).
 *
 * This grants nothing. RevenueCat's server calls our webhook, which is the only
 * thing that can change an entitlement; the app just re-reads
 * `GET /me/entitlement` afterwards. So the worst a tampered client can do here
 * is lie to itself.
 */

function toProduct(pkg: PurchasesPackage, sku: SkuId): Product {
  return {
    sku,
    // The store's own localized string — currency, tax display and regional
    // pricing are its business, never ours to format.
    priceLabel: pkg.product.priceString,
    subscription: pkg.product.productCategory === PRODUCT_CATEGORY.SUBSCRIPTION,
  };
}

function isPurchasesError(error: unknown): error is PurchasesError {
  return typeof error === 'object' && error !== null && 'code' in error;
}

/**
 * Build a gateway backed by the store.
 *
 * `getAppUserId` must return **our** user id, because RevenueCat sends it to
 * our webhook as `app_user_id` and that is what the entitlement is granted
 * against (services/api/src/billing-handlers.ts). Configure with an anonymous
 * id and a completed purchase would credit nobody.
 *
 * It is a getter, and configuration is deferred to the first store call,
 * because the gateway is built at app launch — before anyone has signed in.
 */
export function makePurchaseGateway(apiKey: string, getAppUserId: () => string | null): PurchaseGateway {
  let identity: string | null = null;

  async function configured(): Promise<void> {
    const appUserId = getAppUserId();
    if (appUserId === null) throw new Error('Sign in before buying, so the purchase reaches your account.');
    if (identity === appUserId) return;
    if (identity === null) Purchases.configure({ apiKey, appUserID: appUserId });
    // A different user on the same device: hand the SDK the new identity rather
    // than leaving purchases pointed at whoever signed in first.
    else await Purchases.logIn(appUserId);
    identity = appUserId;
  }

  /** Packages from the current offering, keyed by the SKU they map to. */
  async function packages(): Promise<Map<SkuId, PurchasesPackage>> {
    await configured();
    const offerings = await Purchases.getOfferings();
    const found = new Map<SkuId, PurchasesPackage>();
    for (const pkg of offerings.current?.availablePackages ?? []) {
      const sku = skuOf(pkg.product.identifier);
      // A package we do not recognise is skipped rather than shown: the plan
      // screen prices from our own SKU list, and an unmapped product could not
      // be granted by the webhook anyway.
      if (sku && !found.has(sku)) found.set(sku, pkg);
    }
    return found;
  }

  return {
    async listProducts() {
      const found = await packages();
      // OFFERED_SKUS order, not the store's — the plan screen relies on it.
      return OFFERED_SKUS.flatMap((sku) => {
        const pkg = found.get(sku);
        return pkg ? [toProduct(pkg, sku)] : [];
      });
    },

    async purchase(sku: SkuId): Promise<PurchaseResult> {
      const pkg = (await packages()).get(sku);
      if (!pkg) throw new Error(`No store product is configured for ${sku}.`);
      try {
        await Purchases.purchasePackage(pkg);
        return { status: 'purchased', sku };
      } catch (error) {
        if (!isPurchasesError(error)) throw error;
        if (error.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return { status: 'cancelled' };
        // "Ask to Buy" and other deferred approvals are not failures: the
        // purchase may complete hours later, through the webhook.
        if (error.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return { status: 'pending' };
        throw new Error(error.message);
      }
    },

    async restore() {
      await configured();
      await Purchases.restorePurchases();
    },
  };
}
