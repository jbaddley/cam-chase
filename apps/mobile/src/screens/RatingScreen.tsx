import { useEffect, useState } from 'react';
import { ApiError, type RateableView } from '@photochase/client';
import type { FoulReason } from '@photochase/shared';
import { client } from '../api.js';
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

