import { useEffect, useState } from 'react';
import { ApiError, type ReferralView } from '@photochase/client';
import type { Flair, GameMode } from '@photochase/shared';
import type { MessageKey } from '@photochase/i18n';
import { client } from '../api.js';
import { t } from '../i18n.js';
import { Body, Button, Card, ErrorText, Field, Heading, Pill, Screen, Title } from '../ui.js';

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
    <Screen scroll>
      <Title>{t('referral.title')}</Title>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {referral ? (
        <Card tone="highlight">
          <Heading>{t('referral.yourCode', { code: referral.code })}</Heading>
          <Body muted>{referral.inviteUrl}</Body>
          <Body>{t('referral.credited', { count: referral.creditedReferrals })}</Body>

          {referral.nextUnlock ? (
            <Body muted>
              {t('referral.nextUnlock', {
                count: referral.nextUnlock.referralsAway,
                mode: t(MODE_KEY[referral.nextUnlock.mode]),
              })}
            </Body>
          ) : (
            <Body muted>{t('referral.laddered')}</Body>
          )}

          {referral.modesEarned.length > 0 ? (
            <Pill tone="positive">
              {t('referral.earned', { modes: referral.modesEarned.map((m) => t(MODE_KEY[m])).join(', ') })}
            </Pill>
          ) : null}

          {referral.flair ? (
            <Pill>{t('referral.flair', { flair: t(FLAIR_KEY[referral.flair]) })}</Pill>
          ) : null}

          {/* The reward a subscriber can actually use: their guests play free. */}
          <Body muted>{t('referral.hostPerk')}</Body>
        </Card>
      ) : null}

      <Field
        label={t('referral.redeem')}
        value={code}
        onChangeText={(text) => setCode(text.toUpperCase())}
        maxLength={6}
        autoCapitalize="characters"
      />
      <Button onPress={redeem}>{busy ? t('purchase.buying') : t('referral.redeem')}</Button>
      {status ? <Pill>{status}</Pill> : null}

      {onBack ? (
        <Button onPress={onBack} tone="secondary">
          {t('common.back')}
        </Button>
      ) : null}
    </Screen>
  );
}

