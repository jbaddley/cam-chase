import { useEffect, useState } from 'react';
import { ApiError, type GuessTargetView } from '@photochase/client';
import { COLORS, MOTIFS, SHAPES, type AttributeGuess } from '@photochase/shared';
import { client } from '../api.js';
import { Body, Button, Card, Chip, ChoiceRow, ErrorText, Heading, Loading, Pill, Screen, Title } from '../ui.js';
import { t } from '../i18n.js';

type Axis = 'color' | 'shape' | 'motif';

const OPTIONS: Record<Axis, readonly string[]> = { color: COLORS, shape: SHAPES, motif: MOTIFS };

/**
 * Colour Hunt guessing window: study each other team's photos and commit what
 * you think they were hiding.
 *
 * A guess is revisable until the host closes the window, so a team can change
 * its mind as it studies — the lock is the phase change, not the first tap.
 * Only one modifier axis can be right, but both are offered because a guesser
 * does not know which the other team was given; picking the wrong axis is
 * simply a wrong guess, and is scored as one.
 */
export function GuessScreen({ gameId, locked = false }: { gameId: string; locked?: boolean }) {
  const [targets, setTargets] = useState<GuessTargetView[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AttributeGuess>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .listGuessTargets(gameId)
      .then((list) => {
        if (!active) return;
        setTargets(list);
        // Seed the drafts from whatever was already committed, so reopening the
        // screen shows the team's current answer rather than a blank slate.
        setDrafts(Object.fromEntries(list.map((target) => [target.teamId, target.myGuess ?? {}])));
      })
      .catch(() => {
        if (active) setError(t('color.failed'));
      });
    return () => {
      active = false;
    };
  }, [gameId]);

  function pick(teamId: string, axis: Axis, value: string): void {
    setDrafts((current) => {
      const draft = { ...(current[teamId] ?? {}) };
      // Tapping the chosen option again clears it — a guess left blank is a
      // legitimate answer, not a dead end.
      if (draft[axis] === value) delete draft[axis];
      else Object.assign(draft, { [axis]: value });
      return { ...current, [teamId]: draft };
    });
  }

  async function commit(teamId: string): Promise<void> {
    if (busy || locked) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await client.submitGuess(gameId, { subjectTeamId: teamId, guess: drafts[teamId] ?? {} });
      setStatus(t('color.committed'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('color.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!targets) {
    return (
      <Loading title={t('color.guessTitle')} message={error ?? t('watch.connecting')} />
    );
  }

  return (
    <Screen scroll>
      <Title>{t('color.guessTitle')}</Title>
      {locked ? <Body muted>{t('color.locked')}</Body> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {status ? <Pill>{status}</Pill> : null}

      {targets.map((target) => (
        <Card key={target.teamId}>
          <Heading>{t('color.guessFor', { team: target.teamName })}</Heading>
          <Body muted>{t('color.photosToStudy', { count: target.photoKeys.length })}</Body>
          {(['color', 'shape', 'motif'] as const).map((axis) => (
            <ChoiceRow key={axis} label={t(`color.${axis}` as 'color.color')}>
              {OPTIONS[axis].map((option) => (
                <Chip
                  key={option}
                  onPress={() => pick(target.teamId, axis, option)}
                  selected={drafts[target.teamId]?.[axis] === option}
                >
                  {option}
                </Chip>
              ))}
            </ChoiceRow>
          ))}
          <Button onPress={() => commit(target.teamId)} disabled={locked}>
            {t('color.commit')}
          </Button>
        </Card>
      ))}
    </Screen>
  );
}

