import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '@photochase/client';
import { client } from '../api.js';

/** Handed back once the player is in the lobby, so the app can poll teams. */
export interface JoinedGame {
  gameId: string;
  code: string;
  teamId: string | null;
  role: string;
}

/** Enter a 6-character game code (or arrive here via a scanned QR deep link). */
export function JoinScreen({ onJoined, onHost }: { onJoined: (game: JoinedGame) => void; onHost?: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = code.length === 6 && name.trim().length > 0 && teamName.trim().length > 0 && !busy;

  async function submit(): Promise<void> {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.joinGame({
        code,
        displayName: name.trim(),
        action: { type: 'create_team', name: teamName.trim() },
      });
      onJoined({ gameId: result.gameId, code, teamId: result.teamId, role: result.role });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not join the game. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join a game</Text>
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        placeholder="ABC123"
        maxLength={6}
        autoCapitalize="characters"
        style={styles.input}
      />
      <TextInput value={name} onChangeText={setName} placeholder="Your name" style={styles.textField} />
      <TextInput value={teamName} onChangeText={setTeamName} placeholder="Team name" style={styles.textField} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable onPress={submit} style={styles.button}>
        <Text>{busy ? 'Joining…' : 'Join'}</Text>
      </Pressable>
      {onHost ? (
        <Pressable onPress={onHost} style={styles.secondary}>
          <Text>Host a game instead</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  input: { fontSize: 24, letterSpacing: 4, borderWidth: 1, padding: 12 },
  textField: { fontSize: 18, borderWidth: 1, padding: 12 },
  error: { color: '#c92a2a' },
  button: { backgroundColor: '#ffd43b', padding: 16, borderRadius: 12, alignItems: 'center' },
  secondary: { padding: 16, borderRadius: 12, alignItems: 'center' },
});
