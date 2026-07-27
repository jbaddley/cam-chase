import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { EntitlementView } from '@photochase/client';
import type { MessageKey } from '@photochase/i18n';
import type { SkuId } from '@photochase/shared';
import { client } from '../api.js';
import { t } from '../i18n.js';
import { listPriceLabel, OFFERED_SKUS, unavailablePurchaseGateway, type Product, type PurchaseGateway } from '../purchases.js';

/**
 * Feature rows, labelled from the entitlement's own flags. The server sends the
 * matrix, so this screen never restates the tier rules and cannot drift from
 * them when pricing changes.
 */
const FEATURE_LABEL: Record<string, string> = {
  ai_judging: 'AI judging',
  geofencing: 'Geofencing & return bonuses',
  special_categories: 'Special categories',
  random_game_type: 'Random game type',
  judge_weight_over_1: 'Weighted judge votes',
  up_to_6_teams: 'Up to 6 teams',
};

const SKU_KEY: Record<SkuId, MessageKey | undefined> = {
  game_pack: 'purchase.sku.game_pack',
  unlimited_monthly: 'purchase.sku.unlimited_monthly',
  annual: 'purchase.sku.annual',
  lifetime: 'purchase.sku.lifetime',
  game_pack_launch: undefined,
};

/**
 * Current plan, what it unlocks, and the upgrades on offer.
 *
 * Buying never grants anything locally: the store notifies the server's
 * webhook, and the app re-reads the entitlement afterwards. A purchase that the
 * server has not recorded therefore shows no upgrade, which is the point.
 */
export function PlanScreen({
  onBack,
  purchases = unavailablePurchaseGateway,
}: {
  onBack: () => void;
  purchases?: PurchaseGateway;
}) {
  const [entitlement, setEntitlement] = useState<EntitlementView | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [buying, setBuying] = useState<SkuId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadEntitlement = useCallback(
    () => client.getEntitlement().then(setEntitlement),
    [],
  );

  // The store reports renewals, lapses and refunds — including ones that
  // happened on another device. It carries no entitlement data: the only
  // correct reaction is to ask our own API again, which the provider's webhook
  // has already updated. Without this, a subscription that lapsed mid-session
  // would keep showing as active until the screen was reopened.
  useEffect(() => {
    if (!purchases.subscribe) return;
    return purchases.subscribe(() => {
      loadEntitlement().catch(() => undefined);
    });
  }, [purchases, loadEntitlement]);

  useEffect(() => {
    let active = true;
    loadEntitlement().catch(() => {
      if (active) setError(t('plan.failed'));
    });
    // A missing store SDK must not break the plan view; the upgrade list is
    // simply empty when no gateway is configured.
    purchases
      .listProducts()
      .then((list) => {
        if (active) setProducts(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loadEntitlement, purchases]);

  async function buy(sku: SkuId): Promise<void> {
    if (buying) return;
    setBuying(sku);
    setNotice(null);
    setError(null);
    try {
      const result = await purchases.purchase(sku);
      if (result.status === 'cancelled') return; // a normal choice, not an error
      if (result.status === 'pending') {
        setNotice(t('purchase.pending'));
        return;
      }
      // The store told its server; re-read what we are actually entitled to.
      await loadEntitlement();
    } catch {
      setError(t('purchase.failed'));
    } finally {
      setBuying(null);
    }
  }

  async function restore(): Promise<void> {
    setNotice(null);
    setError(null);
    try {
      await purchases.restore();
      await loadEntitlement();
      setNotice(t('purchase.restored'));
    } catch {
      setError(t('purchase.unavailable'));
    }
  }

  if (!entitlement) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{t('plan.title')}</Text>
        <Text style={styles.subtitle}>{error ?? t('plan.loading')}</Text>
        <Pressable onPress={onBack} style={styles.secondary}>
          <Text>{t('common.back')}</Text>
        </Pressable>
      </View>
    );
  }

  const offers = OFFERED_SKUS.map((sku) => ({
    sku,
    product: products.find((p) => p.sku === sku),
  })).filter((offer) => offer.product);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('plan.title')}</Text>
      <Text style={styles.subtitle}>{t('plan.currentTier', { tier: entitlement.tier })}</Text>

      {entitlement.subscriptionActive ? (
        <Text style={styles.detail}>{t('plan.subscriptionActive')}</Text>
      ) : entitlement.tier === 'game_pack' ? (
        <Text style={styles.detail}>{t('plan.creditsLeft', { count: entitlement.gameCredits })}</Text>
      ) : null}

      {/* The server's own reason, so the wording matches what blocked the start. */}
      {entitlement.cannotStartReason ? <Text style={styles.error}>{entitlement.cannotStartReason}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>{t('plan.unlocks')}</Text>
      <ScrollView>
        <View style={styles.row}>
          <Text>{t('plan.maxTeams', { count: entitlement.limits.maxTeams })}</Text>
          <Text style={styles.on}>✓</Text>
        </View>
        {Object.entries(entitlement.features).map(([feature, enabled]) => (
          <View key={feature} style={styles.row}>
            <Text style={enabled ? undefined : styles.muted}>{FEATURE_LABEL[feature] ?? feature}</Text>
            <Text style={enabled ? styles.on : styles.muted}>{enabled ? '✓' : '—'}</Text>
          </View>
        ))}

        {offers.length > 0 ? (
          <View>
            <Text style={styles.sectionTitle}>{t('plan.upgrade')}</Text>
            {offers.map(({ sku, product }) => {
              const key = SKU_KEY[sku];
              return (
                <View key={sku} style={styles.row}>
                  <Text>
                    {key ? t(key) : sku} · {product!.priceLabel || listPriceLabel(sku)}
                  </Text>
                  <Pressable onPress={() => buy(sku)} style={styles.buy}>
                    <Text>{buying === sku ? t('purchase.buying') : t('purchase.buy')}</Text>
                  </Pressable>
                </View>
              );
            })}
            <Pressable onPress={restore} style={styles.secondary}>
              <Text>{t('purchase.restore')}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <Pressable onPress={onBack} style={styles.secondary}>
        <Text>{t('common.back')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 18, color: '#1971c2' },
  detail: { color: '#666' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  on: { color: '#2f9e44' },
  muted: { color: '#adb5bd' },
  notice: { color: '#2f9e44' },
  error: { color: '#c92a2a' },
  buy: { backgroundColor: '#ffd43b', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  secondary: { padding: 16, borderRadius: 12, alignItems: 'center' },
});
