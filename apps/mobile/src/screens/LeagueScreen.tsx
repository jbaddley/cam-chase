import { useState } from 'react';
import { ApiError, type EntitlementView, type StandingsView } from '@photochase/client';
import { StyleSheet, Text } from 'react-native';
import { client } from '../api.js';
import { t } from '../i18n.js';
import { color, type as typeScale } from '../theme.js';
import { Body, Button, Card, ErrorText, Field, Heading, Row, Screen, Title } from '../ui.js';

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
    <Screen scroll>
      <Title>{t('league.title')}</Title>
      {error ? <ErrorText>{error}</ErrorText> : null}

      <Field
        value={code}
        onChangeText={(text) => setCode(text.toUpperCase())}
        placeholder={t('league.codePlaceholder')}
        maxLength={6}
        autoCapitalize="characters"
      />
      <Button onPress={look}>{t('league.lookup')}</Button>

      {league ? (
        <Card>
          <Heading>{league.name}</Heading>
          <Body muted>{t('league.code', { code: league.code })}</Body>
          <Body muted>{t('league.games', { count: league.gamesPlayed })}</Body>
          {league.standings.length === 0 ? (
            <Body muted>{t('league.empty')}</Body>
          ) : (
            <>
              <Row>
                <Text style={styles.headTeam}>{t('league.title')}</Text>
                <Text style={styles.headStat}>{t('league.played')}</Text>
                <Text style={styles.headStat}>{t('league.won')}</Text>
                <Text style={styles.headStat}>{t('league.points')}</Text>
              </Row>
              {league.standings.map((standing, i) => (
                <Row key={standing.teamKey}>
                  <Text style={styles.team}>
                    {i + 1}. {standing.teamName}
                  </Text>
                  <Text style={styles.stat}>{standing.gamesPlayed}</Text>
                  <Text style={styles.stat}>{standing.wins}</Text>
                  <Text style={styles.points}>{standing.placementPoints}</Text>
                </Row>
              ))}
            </>
          )}
        </Card>
      ) : null}

      <Field value={name} onChangeText={setName} placeholder={t('league.name')} maxLength={60} />
      <Button onPress={create} disabled={!canCreate}>
        {t('league.create')}
      </Button>
      {/* Shown rather than hiding the control: a host should see what a plan buys. */}
      {canCreate ? null : <Body muted>{t('league.paidOnly')}</Body>}

      {onBack ? (
        <Button onPress={onBack} tone="secondary">
          {t('common.back')}
        </Button>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headTeam: { flex: 3, ...typeScale.label, color: color.inkMuted },
  headStat: { flex: 1, ...typeScale.label, color: color.inkMuted },
  team: { flex: 3, ...typeScale.body, color: color.ink },
  stat: { flex: 1, ...typeScale.body, color: color.ink },
  points: { flex: 1, ...typeScale.body, fontWeight: '700', color: color.accent },
});
