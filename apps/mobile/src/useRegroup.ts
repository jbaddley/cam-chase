import { useCallback, useEffect, useState } from 'react';
import type { RegroupView } from '@photochase/client';
import { client } from './api.js';

/** Matches the phase poll: the two are read side by side. */
const POLL_MS = 3000;

/**
 * Poll who is back at the start point.
 *
 * Separate from `useGamePhase` because it is a different question with a
 * different lifetime — the phase matters for the whole game, this only while a
 * round is running — and because `applyState` can only patch the phase. A team
 * checking in changes the roster, not the state, so there is nothing to patch
 * optimistically and `refresh` exists for the moment after your own check-in.
 *
 * Owned by `GameRouter` so the poll is in one place and the screens take what it
 * finds as props, which is how every other screen here gets its state.
 */
export function useRegroup(
  gameId: string,
  active: boolean,
): { regroup: RegroupView | null; error: string | null; refresh: () => void } {
  const [regroup, setRegroup] = useState<RegroupView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRegroup(await client.getRegroup(gameId));
      setError(null);
    } catch {
      // Deliberately quiet about the reason. The regroup view is refused outside
      // a round, which is a normal thing to be for most of a game.
      setError('Reconnecting…');
    }
  }, [gameId]);

  useEffect(() => {
    if (!active) {
      setRegroup(null);
      return;
    }
    let running = true;
    const tick = () => {
      if (running) void load();
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      running = false;
      clearInterval(timer);
    };
  }, [active, load]);

  return { regroup, error, refresh: () => void load() };
}
