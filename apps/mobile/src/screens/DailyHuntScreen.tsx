import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, type DailyHuntView } from '@photochase/client';
import { client } from '../api.js';
import { t } from '../i18n.js';

/**
 * The solo daily hunt: the answer to opening the app when nobody is around.
 *
 * Free on every plan, unlike the scavenger hunt it is built from — a daily run
 * is the mode's best advert, and gating it would starve the funnel it feeds.
 * One run per person per UTC day, resumable, against a list that is identical
 * worldwide.
 */
export function DailyHuntScreen({
  onPlaying,
  onBack,
}: {
  onPlaying?: (gameId: string) => void;
  onBack?: () => void;
}) {
  const [run, setRun] = useState<DailyHuntView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function play(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const started = await client.startDailyHunt();
      setRun(started);
      onPlaying?.(started.gameId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('daily.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('daily.title')}</Text>
      <Text style={styles.blurb}>{t('daily.blurb')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable onPress={play} style={styles.button}>
        <Text>{run?.resumed ? t('daily.resume') : t('daily.start')}</Text>
      </Pressable>

      {onBack ? (
        <Pressable onPress={onBack} style={styles.secondary}>
          <Text>{t('common.back')}</Text>
        </Pressable>
      ) : null}

      {run ? (
        <View style={styles.list}>
          <Text style={styles.theme}>{t('daily.theme', { theme: run.theme })}</Text>
          <ScrollView>
            {run.items.map((item) => (
              <View key={item.id} style={styles.row}>
                <Text style={styles.itemLabel}>{item.label}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 10 },
  title: { fontSize: 28, fontWeight: '700' },
  blurb: { color: '#666' },
  error: { color: '#c92a2a' },
  button: { backgroundColor: '#ffd43b', padding: 16, borderRadius: 12, alignItems: 'center' },
  secondary: { padding: 16, borderRadius: 12, alignItems: 'center' },
  list: { paddingVertical: 12, gap: 6 },
  theme: { fontSize: 18, fontWeight: '600' },
  row: { backgroundColor: '#e9ecef', padding: 12, borderRadius: 10, marginBottom: 6 },
  itemLabel: { fontSize: 16 },
});
