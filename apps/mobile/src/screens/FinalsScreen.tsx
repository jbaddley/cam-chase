import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, type FinalsView } from '@photochase/client';
import { client } from '../api.js';

/**
 * Finals voting: pick a winner per category. The server rejects voting for your
 * own team, so those buttons are disabled here rather than failing on tap.
 */
export function FinalsScreen({ gameId, myTeamId }: { gameId: string; myTeamId: string | null }) {
  const [finals, setFinals] = useState<FinalsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .getFinals(gameId)
      .then((f) => {
        if (active) setFinals(f);
      })
      .catch(() => {
        if (active) setError('Could not load the finals ballot.');
      });
    return () => {
      active = false;
    };
  }, [gameId]);

  async function vote(category: string, teamId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.castFinalsVote(gameId, { category, teamId });
      setFinals((f) => (f ? { ...f, myVotes: { ...f.myVotes, [category]: teamId } } : f));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that vote.');
    } finally {
      setBusy(false);
    }
  }

  if (!finals) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Finals</Text>
        <Text style={styles.subtitle}>{error ?? 'Loading the ballot…'}</Text>
      </View>
    );
  }

  const voted = finals.categories.filter((c) => finals.myVotes[c.id]).length;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Finals</Text>
      <Text style={styles.subtitle}>
        {voted} / {finals.categories.length} categories voted
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView>
        {finals.categories.map((category) => (
          <View key={category.id} style={styles.category}>
            <Text style={styles.categoryLabel}>{category.label}</Text>
            <View style={styles.teams}>
              {finals.teams.map((team) => {
                const own = team.teamId === myTeamId;
                const picked = finals.myVotes[category.id] === team.teamId;
                return (
                  <Pressable
                    key={team.teamId}
                    onPress={() => !own && vote(category.id, team.teamId)}
                    style={own ? styles.teamOwn : picked ? styles.teamPicked : styles.team}
                  >
                    <Text>{own ? `${team.name} (yours)` : team.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#666' },
  error: { color: '#c92a2a' },
  category: { paddingVertical: 12, gap: 8 },
  categoryLabel: { fontSize: 18 },
  teams: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  team: { backgroundColor: '#e9ecef', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8 },
  teamPicked: { backgroundColor: '#ffd43b', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8 },
  teamOwn: { backgroundColor: '#f8f9fa', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, opacity: 0.5 },
});
