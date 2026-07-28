import { useCallback, useEffect, useState } from 'react';
import type { EntitlementView } from '@photochase/client';
import type { MessageKey } from '@photochase/i18n';
import type { SkuId } from '@photochase/shared';
import { client } from '../api.js';
import { StyleSheet, Text } from 'react-native';
import { t } from '../i18n.js';
import { color, type as typeScale } from '../theme.js';
import { Body, Button, Card, ErrorText, Heading, Pill, Row, Screen, Title } from '../ui.js';
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
      <Screen>
        <Title>{t('plan.title')}</Title>
        <Body muted>{error ?? t('plan.loading')}</Body>
        <Button onPress={onBack} tone="secondary">
          {t('common.back')}
        </Button>
      </Screen>
    );
  }

  const offers = OFFERED_SKUS.map((sku) => ({
    sku,
    product: products.find((p) => p.sku === sku),
  })).filter((offer) => offer.product);

  return (
    <Screen scroll>
      <Title>{t('plan.title')}</Title>
      <Pill>{t('plan.currentTier', { tier: entitlement.tier })}</Pill>

      {entitlement.subscriptionActive ? (
        <Body muted>{t('plan.subscriptionActive')}</Body>
      ) : entitlement.tier === 'game_pack' ? (
        <Body muted>{t('plan.creditsLeft', { count: entitlement.gameCredits })}</Body>
      ) : null}

      {/* The server's own reason, so the wording matches what blocked the start. */}
      {entitlement.cannotStartReason ? <ErrorText>{entitlement.cannotStartReason}</ErrorText> : null}
      {notice ? <Pill tone="positive">{notice}</Pill> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}

      <Heading>{t('plan.unlocks')}</Heading>
      <Card>
        <Row>
          <Text style={styles.feature}>{t('plan.maxTeams', { count: entitlement.limits.maxTeams })}</Text>
          <Text style={styles.on}>✓</Text>
        </Row>
        {Object.entries(entitlement.features).map(([feature, enabled]) => (
          <Row key={feature}>
            <Text style={enabled ? styles.feature : styles.muted}>{FEATURE_LABEL[feature] ?? feature}</Text>
            <Text style={enabled ? styles.on : styles.muted}>{enabled ? '✓' : '—'}</Text>
          </Row>
        ))}
      </Card>

      {offers.length > 0 ? (
        <>
          <Heading>{t('plan.upgrade')}</Heading>
          {offers.map(({ sku, product }) => {
            const key = SKU_KEY[sku];
            return (
              <Card key={sku}>
                <Row>
                  <Text style={styles.feature}>
                    {key ? t(key) : sku} · {product!.priceLabel || listPriceLabel(sku)}
                  </Text>
                  <Button onPress={() => buy(sku)}>
                    {buying === sku ? t('purchase.buying') : t('purchase.buy')}
                  </Button>
                </Row>
              </Card>
            );
          })}
          <Button onPress={restore} tone="secondary">
            {t('purchase.restore')}
          </Button>
        </>
      ) : null}

      <Button onPress={onBack} tone="secondary">
        {t('common.back')}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  feature: { ...typeScale.body, color: color.ink, flexShrink: 1 },
  muted: { ...typeScale.body, color: color.inkMuted },
  on: { ...typeScale.body, color: color.positive, fontWeight: '700' },
});
