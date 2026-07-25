import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, type GameStateView, type TeamSummary } from '@photochase/client';
import { client } from '../api.js';

export type LobbyTeam = TeamSummary;

const POLL_MS = 3000;
const MIN_TEAMS = 2;

/** Human-friendly label for each game phase shown in the lobby header. */
const PHASE_LABEL: Record<GameStateView['state'], string> = {
  draft: 'Setting up',
  lobby: 'Waiting for teams',
  round1_active: 'Round 1 in play',
  round1_return: 'Round 1 — returning',
  round2_active: 'Round 2 in play',
  round2_return: 'Round 2 — returning',
  rating: 'Rating photos',
  finals_voting: 'Finals voting',
  results: 'Results',
  archived: 'Archived',
};

/**
 * Live lobby driven by polling `getGame`: shows the current phase and roster.
 * The host sees a Start control once ≥2 teams have joined. `isHost` is set by
 * the host-create flow (joiners are never hosts).
 */
export function LobbyScreen({
  gameId,
  code,
  isHost = false,
  onEnterRound1,
}: {
  gameId: string;
  code: string;
  isHost?: boolean;
  /** Fired once when the game enters Round 1, with the per-round photo quota. */
  onEnterRound1?: (info: { quota: number }) => void;
}) {
  const [game, setGame] = useState<GameStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let active = true;
    let signaled = false;

    async function refresh(): Promise<void> {
      try {
        const next = await client.getGame(gameId);
        if (!active) return;
        setGame(next);
        setError(null);
        if (!signaled && next.state === 'round1_active') {
          signaled = true;
          onEnterRound1?.({ quota: next.config.photosPerRound });
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
  }, [gameId, onEnterRound1]);

  async function start(): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      const { state } = await client.startGame(gameId);
      setGame((g) => (g ? { ...g, state } : g));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the game.');
    } finally {
      setStarting(false);
    }
  }

  const teams = game?.teams ?? [];
  const canStart = isHost && game?.state === 'lobby' && teams.length >= MIN_TEAMS;

  return (
    <View style={styles.container}>
      <Text style={styles.code}>Code: {code}</Text>
      <Text style={styles.phase}>{game ? PHASE_LABEL[game.state] : 'Loading…'}</Text>
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
      {canStart ? (
        <Pressable onPress={start} style={styles.button}>
          <Text>{starting ? 'Starting…' : 'Start game'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 8 },
  code: { fontSize: 24, fontWeight: '700' },
  phase: { fontSize: 18, color: '#1971c2' },
  subtitle: { color: '#666' },
  error: { color: '#c92a2a' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  teamName: { fontSize: 18 },
  button: { backgroundColor: '#ffd43b', padding: 16, borderRadius: 12, alignItems: 'center' },
});
