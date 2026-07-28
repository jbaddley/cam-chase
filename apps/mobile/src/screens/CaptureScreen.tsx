import { useState } from 'react';
import { ApiError, type GeoPointInput } from '@photochase/client';
import { client } from '../api.js';
import { CaptureError } from '../capture.js';
import { Body, Button, ErrorText, Title } from '../ui.js';
import { useViewfinder } from '../viewfinder.js';
import { ViewfinderFrame } from './ViewfinderFrame.js';

/**
 * Produces a photo and its capture location. Injected so the screen is testable
 * and decoupled from the native camera; the real expo-camera + expo-location
 * implementation is wired in a later phase.
 */
export type CaptureSource = () => Promise<{ file: Blob; location: GeoPointInput }>;

/**
 * Round 1 capture: take up to `quota` photos for the player's team. Each capture
 * runs the full upload → submit flow via the client.
 */
export function CaptureScreen({
  gameId,
  teamId,
  quota,
  capture,
  taken: serverTaken = 0,
}: {
  gameId: string;
  teamId: string;
  quota: number;
  capture: CaptureSource;
  /**
   * How many photos the server has for this team. The local count resets on a
   * force-quit, which used to show 0/8 to a team that had taken six.
   */
  taken?: number;
}) {
  useViewfinder();
  const [localTaken, setLocalTaken] = useState(0);
  // The higher of the two: the server may lag a just-taken photo, and the local
  // count may be a fresh launch that missed everything before it.
  const taken = Math.max(serverTaken, localTaken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = taken >= quota;

  async function take(): Promise<void> {
    if (busy || done) return;
    setBusy(true);
    setError(null);
    try {
      const { file, location } = await capture();
      await client.capturePhoto(gameId, { teamId, location, file });
      setLocalTaken((n) => n + 1);
    } catch (e) {
      // A `CaptureError` says something the player can act on — the camera is
      // still warming up, or location is off — so it is shown rather than
      // flattened into the generic retry text.
      setError(
        e instanceof ApiError || e instanceof CaptureError
          ? e.message
          : 'Could not save that photo. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ViewfinderFrame
      action={
        <Button onPress={take} disabled={done}>
          {done ? 'All photos taken' : busy ? 'Saving…' : 'Take photo'}
        </Button>
      }
    >
      <Title>Round 1</Title>
      <Body muted>
        {taken} / {quota} photos
      </Body>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </ViewfinderFrame>
  );
}

