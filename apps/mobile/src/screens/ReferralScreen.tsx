import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, type ReferralView } from '@photochase/client';
import type { Flair, GameMode } from '@photochase/shared';
import type { MessageKey } from '@photochase/i18n';
import { client } from '../api.js';
import { t } from '../i18n.js';

const MODE_KEY: Record<GameMode, MessageKey> = {
  photo_chase: 'mode.photoChase',
  scavenger_hunt: 'mode.scavengerHunt',
  color_hunt: 'mode.colorHunt',
  photo_tag: 'mode.photoTag',
};

const FLAIR_KEY: Record<Flair, MessageKey> = {
  scout: 'flair.scout',
  connector: 'flair.connector',
  ringleader: 'flair.ringleader',
  legend: 'flair.legend',
};

/**
 * Invite screen: your code, what it has earned, and what the next rung costs.
 *
 * The currency is *credited* referrals — an invitee who installed and played a
 * game through to the end — so the count shown here is deliberately slower to
 * move than an install counter would be. That is what makes a mode key worth
 * having, and it is stated plainly rather than buried.
 */
export function ReferralScreen({ onBack }: { onBack?: () => void }) {
  const [referral, setReferral] = useState<ReferralView | null>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .getReferral()
      .then((view) => {
        if (active) setReferral(view);
      })
      .catch(() => {
        if (active) setError(t('referral.failed'));
      });
    return () => {
      active = false;
    };
  }, []);

  async function redeem(): Promise<void> {
    if (busy || code.length === 0) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await client.redeemReferral(code);
      setStatus(result.attributed ? t('referral.redeemed') : (result.reason ?? null));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('referral.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('referral.title')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {referral ? (
        <View style={styles.card}>
          <Text style={styles.code}>{t('referral.yourCode', { code: referral.code })}</Text>
          <Text style={styles.url}>{referral.inviteUrl}</Text>
          <Text style={styles.progress}>{t('referral.credited', { count: referral.creditedReferrals })}</Text>

          {referral.nextUnlock ? (
            <Text style={styles.next}>
              {t('referral.nextUnlock', {
                count: referral.nextUnlock.referralsAway,
                mode: t(MODE_KEY[referral.nextUnlock.mode]),
              })}
            </Text>
          ) : (
            <Text style={styles.next}>{t('referral.laddered')}</Text>
          )}

          {referral.modesEarned.length > 0 ? (
            <Text style={styles.earned}>
              {t('referral.earned', { modes: referral.modesEarned.map((m) => t(MODE_KEY[m])).join(', ') })}
            </Text>
          ) : null}

          {referral.flair ? (
            <Text style={styles.flair}>{t('referral.flair', { flair: t(FLAIR_KEY[referral.flair]) })}</Text>
          ) : null}

          {/* The reward a subscriber can actually use: their guests play free. */}
          <Text style={styles.perk}>{t('referral.hostPerk')}</Text>
        </View>
      ) : null}

      <Text style={styles.label}>{t('referral.redeem')}</Text>
      <TextInput
        value={code}
        onChangeText={(text) => setCode(text.toUpperCase())}
        maxLength={6}
        autoCapitalize="characters"
        style={styles.input}
      />
      <Pressable onPress={redeem} style={styles.button}>
        <Text>{busy ? t('purchase.buying') : t('referral.redeem')}</Text>
      </Pressable>
      {status ? <Text style={styles.status}>{status}</Text> : null}

      {onBack ? (
        <Pressable onPress={onBack} style={styles.secondary}>
          <Text>{t('common.back')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 10 },
  title: { fontSize: 28, fontWeight: '700' },
  error: { color: '#c92a2a' },
  card: { gap: 6, paddingVertical: 12 },
  code: { fontSize: 22, fontWeight: '700' },
  url: { color: '#1971c2' },
  progress: { fontSize: 18 },
  next: { fontSize: 16, color: '#e8590c' },
  earned: { color: '#2f9e44' },
  flair: { fontWeight: '600' },
  perk: { color: '#666' },
  label: { fontSize: 16 },
  input: { borderWidth: 1, borderColor: '#ced4da', borderRadius: 8, padding: 12, fontSize: 20 },
  button: { backgroundColor: '#ffd43b', padding: 16, borderRadius: 12, alignItems: 'center' },
  secondary: { padding: 16, borderRadius: 12, alignItems: 'center' },
  status: { color: '#1971c2' },
});
