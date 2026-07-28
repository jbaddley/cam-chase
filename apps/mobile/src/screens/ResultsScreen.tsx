import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { GameMode, TeamScore } from '@photochase/shared';
import type { TeamSummary } from '@photochase/client';
import { client } from '../api.js';
import { t } from '../i18n.js';
import { useCountUp } from '../motion.js';
import { color, radius, space, type as typeScale } from '../theme.js';
import { Button, Card, ErrorText, Loading, Pop, Screen, Title } from '../ui.js';

/**
 * Score components shown under each team's total, in scoring order.
 *
 * Every mode emits the same `TeamScore` so results, spectator view and league
 * standings work without knowing the mode — but the columns mean different
 * things, so only the labels vary. A colour hunt's `location` is guesses read
 * right and its `pose` is the bluff bonus; showing those as "Location" and
 * "Pose" would be actively misleading.
 */
const BREAKDOWN: Array<{ key: keyof TeamScore; label: string }> = [
  { key: 'location', label: 'Location' },
  { key: 'pose', label: 'Pose' },
  { key: 'angle', label: 'Angle' },
  { key: 'timeBonus', label: 'Return bonus' },
  { key: 'bestMatchBonus', label: 'Best match' },
  { key: 'specialBonus', label: 'Special' },
  { key: 'foulPenalty', label: 'Fouls' },
];

/** Per-mode overrides for the columns whose meaning changes. */
const MODE_LABELS: Partial<Record<GameMode, Partial<Record<keyof TeamScore, string>>>> = {
  scavenger_hunt: { location: 'Items found' },
  color_hunt: { location: 'Guessed right', pose: 'Bluff bonus' },
  photo_tag: { location: 'Catches', pose: 'Survival' },
};

/** Final standings with each team's score breakdown, highest total first. */
export function ResultsScreen({
  gameId,
  teams,
  mode = 'photo_chase',
}: {
  gameId: string;
  teams: TeamSummary[];
  mode?: GameMode;
}) {
  const [scoreboard, setScoreboard] = useState<TeamScore[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<boolean | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .getResults(gameId)
      .then(({ scoreboard: s }) => {
        if (active) setScoreboard([...s].sort((a, b) => b.total - a.total));
      })
      .catch(() => {
        if (active) setError('Could not load the results.');
      });
    return () => {
      active = false;
    };
  }, [gameId]);

  const nameOf = (teamId: string) => teams.find((team) => team.teamId === teamId)?.name ?? teamId;

  /**
   * Sharing consent is asked here, at the moment there is something worth
   * sharing, and it stays answerable both ways — a "yes" that cannot be taken
   * back is not consent (docs/07).
   */
  async function answerConsent(answer: boolean): Promise<void> {
    setConsentError(null);
    try {
      const { consent: saved } = await client.setSharingConsent(gameId, answer);
      setConsent(saved);
    } catch {
      setConsentError(t('share.consentFailed'));
    }
  }

  if (!scoreboard) {
    return (
      <Loading title="Results" message={error ?? 'Tallying scores…'} />
    );
  }

  const winner = scoreboard[0];

  return (
    <Screen>
      <Title>Results</Title>
      <ScrollView contentContainerStyle={styles.list}>
        {scoreboard.map((score, i) => (
          <View key={score.teamId} style={i === 0 ? styles.winnerWrap : undefined}>
            {/* Only the winner pops. Used on every row it would stop meaning
                anything, and the point is that first place arrives. */}
            <Maybe pop={i === 0}>
            <Card tone={i === 0 ? 'highlight' : 'plain'}>
              <View style={styles.headerRow}>
                <View style={styles.nameGroup}>
                  {/* A medal beats a number for the top three; everyone else
                      gets their placing, which is what they came to see. */}
                  <View style={[styles.medal, { backgroundColor: color.podium[i] ?? color.surfaceSunken }]}>
                    <Text style={styles.medalText}>{i + 1}</Text>
                  </View>
                  <Text style={i === 0 ? styles.winnerName : styles.teamName}>{nameOf(score.teamId)}</Text>
                </View>
                {i === 0 ? <WinnerTotal total={score.total} /> : <Text style={styles.total}>{score.total}</Text>}
              </View>
              {BREAKDOWN.filter(({ key }) => score[key] !== 0).map(({ key, label }) => (
                <View key={key} style={styles.row}>
                  <Text style={styles.label}>{MODE_LABELS[mode]?.[key] ?? label}</Text>
                  <Text style={styles.value}>{score[key]}</Text>
                </View>
              ))}
            </Card>
            </Maybe>
          </View>
        ))}
        {winner ? <Text style={styles.flourish}>🏆 {nameOf(winner.teamId)} takes it</Text> : null}
      </ScrollView>

      <View style={styles.consent}>
        <Text style={styles.label}>{t('share.consentAsk')}</Text>
        <View style={styles.consentRow}>
          <View style={styles.consentButton}>
            <Button onPress={() => answerConsent(true)} tone={consent === true ? 'primary' : 'secondary'}>
              {t('share.consentYes')}
            </Button>
          </View>
          <View style={styles.consentButton}>
            <Button onPress={() => answerConsent(false)} tone={consent === false ? 'primary' : 'secondary'}>
              {t('share.consentNo')}
            </Button>
          </View>
        </View>
        {consentError ? <ErrorText>{consentError}</ErrorText> : null}
      </View>
    </Screen>
  );
}

/** Wraps in a {@link Pop} or leaves the child alone; keeps the JSX readable. */
function Maybe({ pop, children }: { pop: boolean; children: ReactNode }) {
  return pop ? <Pop>{children}</Pop> : <>{children}</>;
}

/**
 * The winning score, counted up.
 *
 * Its own component because the hook has to run unconditionally, and only the
 * top row animates — a whole scoreboard climbing at once is noise, and the
 * point is to draw the eye to first place.
 */
function WinnerTotal({ total }: { total: number }) {
  return <Text style={styles.winnerTotal}>{useCountUp(total)}</Text>;
}

const styles = StyleSheet.create({
  list: { gap: space.md, paddingBottom: space.lg },
  winnerWrap: { marginBottom: space.xs },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nameGroup: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexShrink: 1 },
  medal: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalText: { ...typeScale.label, color: color.ink },
  teamName: { ...typeScale.heading, color: color.ink, flexShrink: 1 },
  winnerName: { ...typeScale.title, color: color.ink, flexShrink: 1 },
  total: { ...typeScale.heading, color: color.accent },
  winnerTotal: { ...typeScale.display, color: color.primaryDark },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 46 },
  label: { ...typeScale.label, color: color.inkMuted },
  value: { ...typeScale.label, color: color.ink },
  flourish: { ...typeScale.heading, color: color.ink, textAlign: 'center', paddingTop: space.sm },
  consent: { gap: space.sm },
  consentRow: { flexDirection: 'row', gap: space.sm },
  consentButton: { flex: 1 },
});
