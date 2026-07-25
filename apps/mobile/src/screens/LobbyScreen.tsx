import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TeamSummary } from '@photochase/client';
import { client } from '../api.js';

export type LobbyTeam = TeamSummary;

const POLL_MS = 3000;

/** Live roster of teams that have joined; needs ≥2 teams to start. */
export function LobbyScreen({ gameId, code }: { gameId: string; code: string }) {
  const [teams, setTeams] = useState<LobbyTeam[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function refresh(): Promise<void> {
      try {
        const next = await client.listTeams(gameId);
        if (active) {
          setTeams(next);
          setError(null);
        }
      } catch {
        if (active) setError('Reconnecting…');
      }
    }

    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [gameId]);

  return (
    <View style={styles.container}>
      <Text style={styles.code}>Code: {code}</Text>
      <Text style={styles.subtitle}>
        {teams.length} team{teams.length === 1 ? '' : 's'} joined
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView>
        {teams.map((t) => (
          <View key={t.teamId} style={styles.row}>
            <Text style={styles.teamName}>{t.name}</Text>
            <Text>
              {t.memberCount} player{t.memberCount === 1 ? '' : 's'}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  code: { fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#666' },
  error: { color: '#c92a2a' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  teamName: { fontSize: 18 },
});
