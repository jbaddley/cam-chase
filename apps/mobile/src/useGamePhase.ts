import { useEffect, useState } from 'react';
import type { GameStateView } from '@photochase/client';
import { client } from './api.js';

const POLL_MS = 3000;

/**
 * Poll a game's state so screens can react to phase changes (lobby → Round 1 →
 * Round 2 → rating). One poller owned by the app root, shared by every screen,
 * so the phase is a single source of truth. Realtime (AppSync) replaces the
 * polling in a later phase.
 */
export function useGamePhase(gameId: string): {
  game: GameStateView | null;
  error: string | null;
  /** Apply a locally known state change without waiting for the next poll. */
  applyState: (state: GameStateView['state']) => void;
} {
  const [game, setGame] = useState<GameStateView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function refresh(): Promise<void> {
      try {
        const next = await client.getGame(gameId);
        if (!active) return;
        setGame(next);
        setError(null);
      } catch {
        if (active) setError('Reconnecting…');
      }
    }

    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [gameId]);

  return {
    game,
    error,
    applyState: (state) => setGame((g) => (g ? { ...g, state } : g)),
  };
}
