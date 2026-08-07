import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { ApiError, type RateableView } from '@photochase/client';
import type { FoulReason } from '@photochase/shared';
import { client } from '../api.js';
import { color, radius, space, type as typeScale } from '../theme.js';
import { useSignedPhoto } from '../useSignedPhoto.js';
import { Body, Card, ChoiceRow, Chip, ErrorText, Heading, Pill, Screen, Title } from '../ui.js';

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
 * One captioned square. `cover` so a portrait and a landscape shot read as the
 * same shape here, the way they will be scored — a rater comparing pose should
 * not be thrown by one photo being letterboxed.
 */
function Figure({
  label,
  uri,
  failed,
  testID,
}: {
  label: string;
  uri: string | null;
  failed: boolean;
  testID: string;
}) {
  return (
    <View style={styles.figure}>
      <Text style={styles.caption} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.frame}>
        {uri ? (
          <Image testID={testID} source={{ uri }} resizeMode="cover" style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={styles.placeholder}>{failed ? 'Unavailable' : '…'}</Text>
        )}
      </View>
    </View>
  );
}

/**
 * The photos being rated. You cannot score a pose or angle match you cannot see,
 * and this screen used to ask you to — the scoring controls shipped without the
 * pictures they are about. A chase shows the original beside the recreation, so
 * the match is a side-by-side; a hunt shows the single claimed photo.
 */
function RatingPhotos({ gameId, view }: { gameId: string; view: RateableView }) {
  const hunt = Boolean(view.itemId);
  // Hooks run unconditionally; the original is skipped (null) for a hunt claim,
  // which is judged on its own, not against an original.
  const original = useSignedPhoto(gameId, hunt ? null : view.originalPhotoId);
  const recreation = useSignedPhoto(gameId, view.chasePhotoId);

  return (
    <View style={styles.pair}>
      {hunt ? (
        <Figure label="Claimed photo" uri={recreation.uri} failed={recreation.failed} testID="rate-photo-claim" />
      ) : (
        <>
          <Figure label="Original" uri={original.uri} failed={original.failed} testID="rate-photo-original" />
          <Figure label="Recreation" uri={recreation.uri} failed={recreation.failed} testID="rate-photo-chase" />
        </>
      )}
    </View>
  );
}

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
      <Screen>
        <Title>Rating</Title>
        <Body muted>{error ?? 'Loading photos to rate…'}</Body>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Title>Rating</Title>
      <Body muted>
        {done} / {total} rated
      </Body>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {current ? (
        <Card>
          {current.itemLabel ? <Heading>Claimed: {current.itemLabel}</Heading> : null}
          <RatingPhotos gameId={gameId} view={current} />
          {axesFor(current).map((axis) => (
            <ChoiceRow key={axis} label={AXIS_LABEL[axis]}>
              {STARS.map((n) => (
                <Chip key={n} onPress={() => vote(axis, n)} selected={current.myVotes[axis] === n}>
                  {n}
                </Chip>
              ))}
            </ChoiceRow>
          ))}
          <ChoiceRow label={current.itemId ? 'Call a foul' : 'Call a foul on the original'}>
            {(current.itemId ? HUNT_FOULS : FOULS).map(({ reason, label }) => (
              <Chip
                key={reason}
                onPress={() => toggleFoul(reason)}
                selected={current.originalFouls.includes(reason)}
                tone="danger"
              >
                {label}
              </Chip>
            ))}
          </ChoiceRow>
        </Card>
      ) : (
        <Pill>All rated — waiting for the host.</Pill>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  /** Original and recreation side by side, so a match reads as a comparison. */
  pair: { flexDirection: 'row', gap: space.sm },
  figure: { flex: 1, gap: space.xs },
  caption: { ...typeScale.label, color: color.inkMuted },
  /** A square, because scoring is shape-agnostic; cover fills it without letterbox. */
  frame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: { ...typeScale.label, color: color.inkMuted },
});

