import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, type RateableView } from '@photochase/client';
import { client } from '../api.js';

const AXES = ['pose', 'angle'] as const;
type Axis = (typeof AXES)[number];
const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Rating phase: score other teams' chase attempts on pose and angle. The server
 * decides what the player may rate — you never see your own team's chases.
 */
export function RatingScreen({ gameId }: { gameId: string }) {
  const [queue, setQueue] = useState<RateableView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client
      .listRateable(gameId)
      .then((q) => {
        if (active) setQueue(q);
      })
      .catch(() => {
        if (active) setError('Could not load photos to rate.');
      });
    return () => {
      active = false;
    };
  }, [gameId]);

  const rated = (r: RateableView) => r.myVotes.pose !== null && r.myVotes.angle !== null;
  const current = queue?.find((r) => !rated(r)) ?? null;
  const done = queue?.filter(rated).length ?? 0;
  const total = queue?.length ?? 0;

  async function vote(axis: Axis, stars: number): Promise<void> {
    if (busy || !current) return;
    setBusy(true);
    setError(null);
    try {
      await client.castVote(gameId, { assignmentId: current.assignmentId, axis, stars });
      setQueue(
        (q) =>
          q?.map((r) =>
            r.assignmentId === current.assignmentId ? { ...r, myVotes: { ...r.myVotes, [axis]: stars } } : r,
          ) ?? q,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that rating.');
    } finally {
      setBusy(false);
    }
  }

  if (!queue) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Rating</Text>
        <Text style={styles.progress}>{error ?? 'Loading photos to rate…'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Rating</Text>
      <Text style={styles.progress}>
        {done} / {total} rated
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {current ? (
        <View style={styles.card}>
          {AXES.map((axis) => (
            <View key={axis} style={styles.axisRow}>
              <Text style={styles.axisLabel}>{axis === 'pose' ? 'Pose match' : 'Angle match'}</Text>
              <View style={styles.stars}>
                {STARS.map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => vote(axis, n)}
                    style={current.myVotes[axis] === n ? styles.starPicked : styles.star}
                  >
                    <Text>{n}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.doneText}>All rated — waiting for the host.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  progress: { fontSize: 20, color: '#666' },
  error: { color: '#c92a2a' },
  card: { gap: 16, paddingVertical: 16 },
  axisRow: { gap: 8 },
  axisLabel: { fontSize: 18 },
  stars: { flexDirection: 'row', gap: 8 },
  star: { backgroundColor: '#e9ecef', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 8 },
  starPicked: { backgroundColor: '#ffd43b', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 8 },
  doneText: { fontSize: 18, color: '#1971c2' },
});
