import { describe, expect, it } from 'vitest';
import { listPriceLabel, OFFERED_SKUS, skuOf, unavailablePurchaseGateway } from './purchases.js';

describe('skuOf', () => {
  it('matches a bare Play identifier', () => {
    expect(skuOf('game_pack')).toBe('game_pack');
  });

  it('matches a namespaced App Store identifier', () => {
    expect(skuOf('app.photochase.client.unlimited_monthly')).toBe('unlimited_monthly');
  });

  it('returns null for a product we do not sell', () => {
    // Silently mapping an unknown product to something we do sell would show an
    // upgrade the webhook can never grant.
    expect(skuOf('app.photochase.client.mystery_box')).toBeNull();
    expect(skuOf('')).toBeNull();
  });

  it('resolves every offered SKU from its own name', () => {
    for (const sku of OFFERED_SKUS) expect(skuOf(`app.photochase.client.${sku}`)).toBe(sku);
  });
});

describe('unavailablePurchaseGateway', () => {
  it('shows no products rather than failing the plan screen', async () => {
    await expect(unavailablePurchaseGateway.listProducts()).resolves.toEqual([]);
  });

  it('refuses to buy instead of pretending it did', async () => {
    // A silent no-op here would leave the user believing they had upgraded.
    await expect(unavailablePurchaseGateway.purchase('game_pack')).rejects.toThrow();
    await expect(unavailablePurchaseGateway.restore()).rejects.toThrow();
  });
});

describe('listPriceLabel', () => {
  it('formats the list price, for use only before the store answers', () => {
    expect(listPriceLabel('game_pack')).toBe('$3.99');
    expect(listPriceLabel('annual')).toBe('$39.99');
  });
});
