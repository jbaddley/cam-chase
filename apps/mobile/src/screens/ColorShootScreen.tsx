import { useEffect, useState } from 'react';
import type { MySecretView } from '@photochase/client';
import { client } from '../api.js';
import { t } from '../i18n.js';
import { Body, Screen, Title } from '../ui.js';
import { CaptureScreen, type CaptureSource } from './CaptureScreen.js';

/**
 * Colour Hunt shooting round: your secret, then the ordinary capture flow.
 *
 * Without this a player has no way to see what they were assigned — the secret
 * is fetched from a scoped endpoint, not carried in the polled game state,
 * precisely so it cannot leak to the other teams.
 */
export function ColorShootScreen({
  gameId,
  teamId,
  quota,
  capture,
}: {
  gameId: string;
  teamId: string;
  quota: number;
  capture: CaptureSource;
}) {
  const [secret, setSecret] = useState<MySecretView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .getMySecret(gameId)
      .then((view) => {
        if (active) setSecret(view);
      })
      .catch(() => {
        if (active) setError(t('color.noSecret'));
      });
    return () => {
      active = false;
    };
  }, [gameId]);

  return (
    <Screen>
      <Title>
        {secret ? t('color.secret', { secret: secret.description }) : (error ?? t('watch.connecting'))}
      </Title>
      <Body muted>{t('color.brief')}</Body>
      <CaptureScreen gameId={gameId} teamId={teamId} quota={quota} capture={capture} />
    </Screen>
  );
}

