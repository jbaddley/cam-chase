import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '@photochase/client';
import { FREE_CONFIG } from '@photochase/shared';
import { client } from '../api.js';
import type { JoinedGame } from './JoinScreen.js';

/**
 * Create a game as host. The server picks the tier from the signed-in user's
 * entitlement and gates the config accordingly, so the client never asserts its
 * own tier — it just proposes a config and takes the answer.
 */
export function HostScreen({
  onHosting,
  onCancel,
}: {
  /** Called with the created game; the caller enters the lobby as host. */
  onHosting: (game: JoinedGame) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { gameId, code } = await client.createGame(FREE_CONFIG);
      // The host isn't on a team; they run the game and can still spectate.
      onHosting({ gameId, code, teamId: null, role: 'host' });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the game.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Host a game</Text>
      <Text style={styles.subtitle}>
        {FREE_CONFIG.maxTeams} teams · {FREE_CONFIG.photosPerRound} photos per round ·{' '}
        {FREE_CONFIG.round1Minutes} min rounds
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable onPress={create} style={styles.button}>
        <Text>{busy ? 'Creating…' : 'Create game'}</Text>
      </Pressable>
      <Pressable onPress={onCancel} style={styles.secondary}>
        <Text>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 16, color: '#666' },
  error: { color: '#c92a2a' },
  button: { backgroundColor: '#ffd43b', padding: 16, borderRadius: 12, alignItems: 'center' },
  secondary: { padding: 16, borderRadius: 12, alignItems: 'center' },
});
