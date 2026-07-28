import { useEffect, useState } from 'react';
import { ApiError, type AssignmentView } from '@photochase/client';
import { client } from '../api.js';
import { Body, Button, ErrorText, Pill, Screen, Title } from '../ui.js';
import { useViewfinder } from '../viewfinder.js';
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
  useViewfinder();
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
      <Screen>
        <Title>Round 2</Title>
        <Body muted>{error ?? 'Loading your assignments…'}</Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Round 2</Title>
      <Body muted>
        {chased} / {total} chased
      </Body>
      <Pill>{current ? `Recreate photo #${current.order + 1}` : 'All chases submitted!'}</Pill>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button onPress={chase} disabled={!current}>
        {!current ? 'Done' : busy ? 'Saving…' : 'Take chase photo'}
      </Button>
    </Screen>
  );
}

