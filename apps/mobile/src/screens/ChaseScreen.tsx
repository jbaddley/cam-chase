import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, type AssignmentView } from '@photochase/client';
import { client } from '../api.js';
import type { CaptureSource } from './CaptureScreen.js';

/**
 * Round 2: recreate the photos assigned to your team. Works through the queue
 * in order, capturing a chase for each unchased assignment.
 */
export function ChaseScreen({
  gameId,
  teamId,
  capture,
}: {
  gameId: string;
  teamId: string;
  capture: CaptureSource;
}) {
  const [queue, setQueue] = useState<AssignmentView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .listAssignments(gameId)
      .then((q) => {
        if (active) setQueue(q);
      })
      .catch(() => {
        if (active) setError('Could not load your assignments.');
      });
    return () => {
      active = false;
    };
  }, [gameId]);

  const current = queue?.find((a) => a.chasePhotoId === null) ?? null;
  const chased = queue?.filter((a) => a.chasePhotoId !== null).length ?? 0;
  const total = queue?.length ?? 0;

  async function chase(): Promise<void> {
    if (busy || !current) return;
    setBusy(true);
    setError(null);
    try {
      const { file, location } = await capture();
      const { chasePhotoId } = await client.captureChase(gameId, {
        teamId,
        assignmentId: current.assignmentId,
        location,
        file,
      });
      // Mark it chased locally so the queue advances to the next assignment.
      setQueue(
        (q) => q?.map((a) => (a.assignmentId === current.assignmentId ? { ...a, chasePhotoId } : a)) ?? q,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that chase. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!queue) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Round 2</Text>
        <Text style={styles.progress}>{error ?? 'Loading your assignments…'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Round 2</Text>
      <Text style={styles.progress}>
        {chased} / {total} chased
      </Text>
      {current ? (
        <Text style={styles.target}>Recreate photo #{current.order + 1}</Text>
      ) : (
        <Text style={styles.target}>All chases submitted!</Text>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable onPress={chase} style={current ? styles.button : styles.buttonDone}>
        <Text>{!current ? 'Done' : busy ? 'Saving…' : 'Take chase photo'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700' },
  progress: { fontSize: 20, color: '#666' },
  target: { fontSize: 18, color: '#1971c2' },
  error: { color: '#c92a2a' },
  button: { backgroundColor: '#ffd43b', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonDone: { backgroundColor: '#e9ecef', padding: 16, borderRadius: 12, alignItems: 'center' },
});
