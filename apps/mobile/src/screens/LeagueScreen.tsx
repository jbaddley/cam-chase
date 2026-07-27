import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, type EntitlementView, type StandingsView } from '@photochase/client';
import { client } from '../api.js';
import { t } from '../i18n.js';

/**
 * League table and league creation.
 *
 * Creating a league is the paid power; looking one up and playing in it is
 * free, so the lookup half of this screen works on any plan. The table is keyed
 * by team *name* — a team's id is minted per game, so the name is the only
 * thing a group carries from week to week.
 */
export function LeagueScreen({
  entitlement,
  onBack,
}: {
  entitlement?: EntitlementView | null;
  onBack?: () => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [league, setLeague] = useState<StandingsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tolerate a missing flag rather than hiding the only route to a league.
  const canCreate = !entitlement?.features || entitlement.features.create_leagues !== false;

  async function look(): Promise<void> {
    if (busy || code.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setLeague(await client.getStandings(code));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('league.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function create(): Promise<void> {
    if (busy || name.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { code: created } = await client.createTournament(name);
      setCode(created);
      setLeague(await client.getStandings(created));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('league.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('league.title')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TextInput
        value={code}
        onChangeText={(text) => setCode(text.toUpperCase())}
        placeholder={t('league.codePlaceholder')}
        maxLength={6}
        autoCapitalize="characters"
        style={styles.input}
      />
      <Pressable onPress={look} style={styles.button}>
        <Text>{t('league.lookup')}</Text>
      </Pressable>

      {league ? (
        <View style={styles.table}>
          <Text style={styles.leagueName}>{league.name}</Text>
          <Text style={styles.meta}>{t('league.code', { code: league.code })}</Text>
          <Text style={styles.meta}>{t('league.games', { count: league.gamesPlayed })}</Text>
          {league.standings.length === 0 ? (
            <Text style={styles.meta}>{t('league.empty')}</Text>
          ) : (
            <ScrollView>
              <View style={styles.row}>
                <Text style={styles.headTeam}>{t('league.title')}</Text>
                <Text style={styles.headStat}>{t('league.played')}</Text>
                <Text style={styles.headStat}>{t('league.won')}</Text>
                <Text style={styles.headStat}>{t('league.points')}</Text>
              </View>
              {league.standings.map((standing, i) => (
                <View key={standing.teamKey} style={styles.row}>
                  <Text style={styles.team}>
                    {i + 1}. {standing.teamName}
                  </Text>
                  <Text style={styles.stat}>{standing.gamesPlayed}</Text>
                  <Text style={styles.stat}>{standing.wins}</Text>
                  <Text style={styles.points}>{standing.placementPoints}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={t('league.name')}
        maxLength={60}
        style={styles.input}
      />
      <Pressable onPress={create} style={canCreate ? styles.button : styles.buttonLocked}>
        <Text>{t('league.create')}</Text>
      </Pressable>
      {/* Shown rather than hiding the control: a host should see what a plan buys. */}
      {canCreate ? null : <Text style={styles.meta}>{t('league.paidOnly')}</Text>}

      {onBack ? (
        <Pressable onPress={onBack} style={styles.secondary}>
          <Text>{t('common.back')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  error: { color: '#c92a2a' },
  label: { fontSize: 16 },
  input: { borderWidth: 1, borderColor: '#ced4da', borderRadius: 8, padding: 12, fontSize: 18 },
  button: { backgroundColor: '#ffd43b', padding: 14, borderRadius: 12, alignItems: 'center' },
  buttonLocked: { backgroundColor: '#f8f9fa', padding: 14, borderRadius: 12, alignItems: 'center', opacity: 0.5 },
  secondary: { padding: 16, borderRadius: 12, alignItems: 'center' },
  table: { paddingVertical: 12, gap: 4 },
  leagueName: { fontSize: 22, fontWeight: '700' },
  meta: { color: '#666' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  headTeam: { flex: 3, color: '#666' },
  headStat: { flex: 1, color: '#666' },
  team: { flex: 3, fontSize: 16 },
  stat: { flex: 1 },
  points: { flex: 1, fontWeight: '700', color: '#1971c2' },
});
