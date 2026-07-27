import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, type GuessTargetView } from '@photochase/client';
import { COLORS, MOTIFS, SHAPES, type AttributeGuess } from '@photochase/shared';
import { client } from '../api.js';
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
      <View style={styles.container}>
        <Text style={styles.title}>{t('color.guessTitle')}</Text>
        <Text style={styles.meta}>{error ?? t('watch.connecting')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('color.guessTitle')}</Text>
      {locked ? <Text style={styles.meta}>{t('color.locked')}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}

      <ScrollView>
        {targets.map((target) => (
          <View key={target.teamId} style={styles.card}>
            <Text style={styles.subject}>{t('color.guessFor', { team: target.teamName })}</Text>
            <Text style={styles.meta}>{t('color.photosToStudy', { count: target.photoKeys.length })}</Text>
            {(['color', 'shape', 'motif'] as const).map((axis) => (
              <View key={axis} style={styles.axisRow}>
                <Text style={styles.axisLabel}>{t(`color.${axis}` as 'color.color')}</Text>
                <View style={styles.options}>
                  {OPTIONS[axis].map((option) => (
                    <Pressable
                      key={option}
                      onPress={() => pick(target.teamId, axis, option)}
                      style={drafts[target.teamId]?.[axis] === option ? styles.optionPicked : styles.option}
                    >
                      <Text>{option}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
            <Pressable onPress={() => commit(target.teamId)} style={locked ? styles.buttonLocked : styles.button}>
              <Text>{t('color.commit')}</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  meta: { color: '#666' },
  error: { color: '#c92a2a' },
  status: { color: '#1971c2' },
  card: { paddingVertical: 16, gap: 8 },
  subject: { fontSize: 20, fontWeight: '600' },
  axisRow: { gap: 6 },
  axisLabel: { fontSize: 16 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: { backgroundColor: '#e9ecef', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  optionPicked: { backgroundColor: '#ffd43b', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  button: { backgroundColor: '#ffd43b', padding: 14, borderRadius: 12, alignItems: 'center' },
  buttonLocked: { backgroundColor: '#f8f9fa', padding: 14, borderRadius: 12, alignItems: 'center', opacity: 0.5 },
});
