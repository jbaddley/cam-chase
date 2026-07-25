import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '@photochase/client';
import { client } from '../api.js';
import type { CaptureSource } from './CaptureScreen.js';

/**
 * Return phase: head back to the return spot and check in. The earliest
 * check-in on a team sets that team's return time, and faster teams score a
 * larger bonus, so this screen is the whole round for the player.
 */
export function ReturnScreen({ gameId, round, capture }: { gameId: string; round: 1 | 2; capture: CaptureSource }) {
  const [checkedIn, setCheckedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (busy || checkedIn) return;
    setBusy(true);
    setError(null);
    try {
      // The capture source doubles as the location source in the scaffold.
      const { location } = await capture();
      await client.checkIn(gameId, { location });
      setCheckedIn(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not check in. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Round {round} — head back</Text>
      <Text style={styles.subtitle}>
        {checkedIn ? 'Checked in! Waiting for the other teams.' : 'Check in when you reach the return spot.'}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable onPress={submit} style={checkedIn ? styles.buttonDone : styles.button}>
        <Text>{checkedIn ? 'Checked in' : busy ? 'Checking in…' : "We're back"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 18, color: '#666' },
  error: { color: '#c92a2a' },
  button: { backgroundColor: '#ffd43b', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonDone: { backgroundColor: '#e9ecef', padding: 16, borderRadius: 12, alignItems: 'center' },
});
