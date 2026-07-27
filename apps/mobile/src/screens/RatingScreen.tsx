import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, type RateableView } from '@photochase/client';
import type { FoulReason } from '@photochase/shared';
import { client } from '../api.js';

type Axis = 'pose' | 'angle' | 'validity';

const AXIS_LABEL: Record<Axis, string> = {
  pose: 'Pose match',
  angle: 'Angle match',
  validity: 'Does it count?',
};
const STARS = [1, 2, 3, 4, 5] as const;

/** Rule-2 fouls a rater can call on the original photo (doc 01). */
const FOULS: Array<{ reason: FoulReason; label: string }> = [
  { reason: 'missing_clue', label: 'No location clue' },
  { reason: 'missing_face', label: 'No face' },
];

/** The foul that says a hunt photo does not show the item it claims. */
const HUNT_FOULS: Array<{ reason: FoulReason; label: string }> = [
  { reason: 'missing_item', label: "Item isn't there" },
  { reason: 'missing_face', label: 'No face' },
];

/** A hunt claim is judged on validity alone; a chase on pose and angle. */
const axesFor = (r: RateableView): Axis[] => (r.itemId ? ['validity'] : ['pose', 'angle']);

/**
 * Rating phase: score other teams' work. In a chase that means pose and angle
 * against the original; in a scavenger hunt, whether the photo really shows the
 * item claimed. The server decides what the player may rate — you never see
 * your own team's entries.
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

  const rated = (r: RateableView) => axesFor(r).every((axis) => r.myVotes[axis] !== null);
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

  /** Fouls are a claim about the original photo, so they toggle on/off. */
  async function toggleFoul(reason: FoulReason): Promise<void> {
    if (busy || !current) return;
    setBusy(true);
    setError(null);
    const called = current.originalFouls.includes(reason);
    try {
      const { fouls } = called
        ? await client.clearFoul(gameId, current.originalPhotoId, { reason })
        : await client.flagFoul(gameId, current.originalPhotoId, { reason });
      setQueue(
        (q) =>
          q?.map((r) => (r.originalPhotoId === current.originalPhotoId ? { ...r, originalFouls: fouls } : r)) ?? q,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not update that foul.');
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
          {current.itemLabel ? <Text style={styles.itemLabel}>Claimed: {current.itemLabel}</Text> : null}
          {axesFor(current).map((axis) => (
            <View key={axis} style={styles.axisRow}>
              <Text style={styles.axisLabel}>{AXIS_LABEL[axis]}</Text>
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
          <View style={styles.axisRow}>
            <Text style={styles.axisLabel}>{current.itemId ? 'Call a foul' : 'Call a foul on the original'}</Text>
            <View style={styles.stars}>
              {(current.itemId ? HUNT_FOULS : FOULS).map(({ reason, label }) => (
                <Pressable
                  key={reason}
                  onPress={() => toggleFoul(reason)}
                  style={current.originalFouls.includes(reason) ? styles.foulCalled : styles.foul}
                >
                  <Text>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
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
  itemLabel: { fontSize: 20, fontWeight: '600' },
  stars: { flexDirection: 'row', gap: 8 },
  star: { backgroundColor: '#e9ecef', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 8 },
  starPicked: { backgroundColor: '#ffd43b', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 8 },
  foul: { backgroundColor: '#e9ecef', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  foulCalled: { backgroundColor: '#ffa8a8', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  doneText: { fontSize: 18, color: '#1971c2' },
});
