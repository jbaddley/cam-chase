import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TeamScore } from '@photochase/shared';
import type { TeamSummary } from '@photochase/client';
import { client } from '../api.js';
import { t } from '../i18n.js';

/** Score components shown under each team's total, in scoring order. */
const BREAKDOWN: Array<{ key: keyof TeamScore; label: string }> = [
  { key: 'location', label: 'Location' },
  { key: 'pose', label: 'Pose' },
  { key: 'angle', label: 'Angle' },
  { key: 'timeBonus', label: 'Return bonus' },
  { key: 'bestMatchBonus', label: 'Best match' },
  { key: 'specialBonus', label: 'Special' },
  { key: 'foulPenalty', label: 'Fouls' },
];

/** Final standings with each team's score breakdown, highest total first. */
export function ResultsScreen({ gameId, teams }: { gameId: string; teams: TeamSummary[] }) {
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
      <View style={styles.container}>
        <Text style={styles.title}>Results</Text>
        <Text style={styles.subtitle}>{error ?? 'Tallying scores…'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Results</Text>
      <ScrollView>
        {scoreboard.map((score, i) => (
          <View key={score.teamId} style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={styles.rank}>
                {i + 1}. {nameOf(score.teamId)}
              </Text>
              <Text style={styles.total}>{score.total}</Text>
            </View>
            {BREAKDOWN.filter(({ key }) => score[key] !== 0).map(({ key, label }) => (
              <View key={key} style={styles.row}>
                <Text style={styles.label}>{label}</Text>
                <Text>{score[key]}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      <Text style={styles.label}>{t('share.consentAsk')}</Text>
      <View style={styles.consentRow}>
        <Pressable onPress={() => answerConsent(true)} style={consent === true ? styles.picked : styles.choice}>
          <Text>{t('share.consentYes')}</Text>
        </Pressable>
        <Pressable onPress={() => answerConsent(false)} style={consent === false ? styles.picked : styles.choice}>
          <Text>{t('share.consentNo')}</Text>
        </Pressable>
      </View>
      {consentError ? <Text style={styles.error}>{consentError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#666' },
  card: { paddingVertical: 16, gap: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rank: { fontSize: 20, fontWeight: '700' },
  total: { fontSize: 20, fontWeight: '700', color: '#1971c2' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 12 },
  label: { color: '#666' },
  consentRow: { flexDirection: 'row', gap: 8 },
  choice: { backgroundColor: '#e9ecef', padding: 12, borderRadius: 8 },
  picked: { backgroundColor: '#ffd43b', padding: 12, borderRadius: 8 },
  error: { color: '#c92a2a' },
});
