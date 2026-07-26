import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { EntitlementView } from '@photochase/client';
import { client } from '../api.js';
import { t } from '../i18n.js';

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

/** Current plan, remaining credits, and what the tier unlocks. */
export function PlanScreen({ onBack }: { onBack: () => void }) {
  const [entitlement, setEntitlement] = useState<EntitlementView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .getEntitlement()
      .then((view) => {
        if (active) setEntitlement(view);
      })
      .catch(() => {
        if (active) setError(t('plan.failed'));
      });
    return () => {
      active = false;
    };
  }, []);

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
      {entitlement.cannotStartReason ? (
        <Text style={styles.error}>{entitlement.cannotStartReason}</Text>
      ) : null}

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
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  on: { color: '#2f9e44' },
  muted: { color: '#adb5bd' },
  error: { color: '#c92a2a' },
  secondary: { padding: 16, borderRadius: 12, alignItems: 'center' },
});
