import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MySecretView } from '@photochase/client';
import { client } from '../api.js';
import { t } from '../i18n.js';
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
    <View style={styles.container}>
      <Text style={styles.secret}>
        {secret ? t('color.secret', { secret: secret.description }) : (error ?? t('watch.connecting'))}
      </Text>
      <Text style={styles.brief}>{t('color.brief')}</Text>
      <CaptureScreen gameId={gameId} teamId={teamId} quota={quota} capture={capture} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 4 },
  secret: { fontSize: 22, fontWeight: '700', paddingHorizontal: 24, paddingTop: 24 },
  brief: { fontSize: 15, color: '#666', paddingHorizontal: 24 },
});
