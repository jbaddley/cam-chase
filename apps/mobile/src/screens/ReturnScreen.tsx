import { useState } from 'react';
import { ApiError } from '@photochase/client';
import { client } from '../api.js';
import { Body, Button, ErrorText, Screen, Title } from '../ui.js';
import { useViewfinder } from '../viewfinder.js';
import type { CaptureSource } from './CaptureScreen.js';

/**
 * Return phase: head back to the return spot and check in. The earliest
 * check-in on a team sets that team's return time, and faster teams score a
 * larger bonus, so this screen is the whole round for the player.
 */
export function ReturnScreen({ gameId, round, capture }: { gameId: string; round: 1 | 2; capture: CaptureSource }) {
  useViewfinder();
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
    <Screen>
      <Title>Round {round} — head back</Title>
      <Body muted>
        {checkedIn ? 'Checked in! Waiting for the other teams.' : 'Check in when you reach the return spot.'}
      </Body>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button onPress={submit} disabled={checkedIn}>
        {checkedIn ? 'Checked in' : busy ? 'Checking in…' : "We're back"}
      </Button>
    </Screen>
  );
}

