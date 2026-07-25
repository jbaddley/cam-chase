import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, type GameStateView, type TeamSummary } from '@photochase/client';
import { client } from '../api.js';

export type LobbyTeam = TeamSummary;

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
 * Roster and phase display. The game state is polled by the app root and passed
 * in, so every screen agrees on the current phase. The host sees a Start control
 * once ≥2 teams have joined.
 */
export function LobbyScreen({
  game,
  code,
  isHost = false,
  error,
  onStarted,
}: {
  game: GameStateView | null;
  code: string;
  isHost?: boolean;
  error?: string | null;
  /** Called with the new state after the host starts the game. */
  onStarted?: (state: GameStateView['state']) => void;
}) {
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const teams = game?.teams ?? [];
  const canStart = isHost && game?.state === 'lobby' && teams.length >= MIN_TEAMS;

  async function start(): Promise<void> {
    if (!game) return;
    setStarting(true);
    setStartError(null);
    try {
      const { state } = await client.startGame(game.id);
      onStarted?.(state);
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : 'Could not start the game.');
    } finally {
      setStarting(false);
    }
  }

  const shownError = startError ?? error ?? null;

  return (
    <View style={styles.container}>
      <Text style={styles.code}>Code: {code}</Text>
      <Text style={styles.phase}>{game ? PHASE_LABEL[game.state] : 'Loading…'}</Text>
      <Text style={styles.subtitle}>
        {teams.length} team{teams.length === 1 ? '' : 's'} joined
      </Text>
      {shownError ? <Text style={styles.error}>{shownError}</Text> : null}
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
