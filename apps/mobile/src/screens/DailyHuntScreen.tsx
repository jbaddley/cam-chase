import { useState } from 'react';
import { ApiError, type DailyHuntView } from '@photochase/client';
import { client } from '../api.js';
import { t } from '../i18n.js';
import { Body, Button, Card, ErrorText, Heading, Screen, Title } from '../ui.js';

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
    <Screen scroll>
      <Title>{t('daily.title')}</Title>
      <Body muted>{t('daily.blurb')}</Body>
      {error ? <ErrorText>{error}</ErrorText> : null}

      <Button onPress={play}>{run?.resumed ? t('daily.resume') : t('daily.start')}</Button>
      {onBack ? (
        <Button onPress={onBack} tone="secondary">
          {t('common.back')}
        </Button>
      ) : null}

      {run ? (
        <>
          <Heading>{t('daily.theme', { theme: run.theme })}</Heading>
          {run.items.map((item) => (
            <Card key={item.id}>
              <Body>{item.label}</Body>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

