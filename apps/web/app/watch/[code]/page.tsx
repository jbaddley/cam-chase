'use client';

import { useEffect, useState } from 'react';
import type { SpectatorView } from '@photochase/client';
import { client } from '../../api.js';

const POLL_MS = 3000;

/** Phase labels sized for a room reading them from across the couch. */
const PHASE_LABEL: Record<SpectatorView['game']['state'], string> = {
  draft: 'Setting up',
  lobby: 'Waiting for teams',
  round1_active: 'Round 1 — teams are out shooting',
  round1_return: 'Round 1 — heading back',
  round2_active: 'Round 2 — the chase is on',
  round2_return: 'Round 2 — heading back',
  rating: 'Rating the chases',
  finals_voting: 'Finals voting',
  results: 'Final results',
  archived: 'Game over',
};

/**
 * Live big-screen view for a game code. Polls the public spectator endpoint, so
 * it needs no sign-in and can be cast to any TV browser.
 */
export default function BigScreenPage({ params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  const [view, setView] = useState<SpectatorView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function refresh(): Promise<void> {
      try {
        const next = await client.spectate(code);
        if (!active) return;
        setView(next);
        setError(null);
      } catch {
        if (active) setError('Cannot reach that game. Check the code.');
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [code]);

  if (!view) {
    return (
      <main style={styles.main}>
        <h1 style={styles.code}>{code}</h1>
        <p style={styles.phase}>{error ?? 'Connecting…'}</p>
      </main>
    );
  }

  const { game, scoreboard } = view;
  const nameOf = (teamId: string) => game.teams.find((t) => t.teamId === teamId)?.name ?? teamId;
  const standings = scoreboard ? [...scoreboard].sort((a, b) => b.total - a.total) : null;
  const showStandings = standings && (game.state === 'results' || game.state === 'archived');

  return (
    <main style={styles.main}>
      <h1 style={styles.code}>{code}</h1>
      <p style={styles.phase}>{PHASE_LABEL[game.state]}</p>
      {error ? <p style={styles.error}>{error}</p> : null}

      {showStandings ? (
        <ol style={styles.list}>
          {standings.map((score) => (
            <li key={score.teamId} style={styles.row}>
              <span>{nameOf(score.teamId)}</span>
              <strong>{score.total}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <ul style={styles.list}>
          {game.teams.map((team) => (
            <li key={team.teamId} style={styles.row}>
              <span>{team.name}</span>
              <span style={styles.muted}>
                {team.memberCount} player{team.memberCount === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** Inline styles keep the viewer self-contained until the design system lands. */
const styles: Record<string, React.CSSProperties> = {
  main: { padding: '4vh 6vw', fontFamily: 'system-ui, sans-serif' },
  code: { fontSize: '8vw', margin: 0, letterSpacing: '0.1em' },
  phase: { fontSize: '3vw', color: '#1971c2', marginTop: 0 },
  error: { fontSize: '2vw', color: '#c92a2a' },
  list: { listStyle: 'none', padding: 0, fontSize: '3vw' },
  row: { display: 'flex', justifyContent: 'space-between', padding: '1vh 0', borderBottom: '1px solid #dee2e6' },
  muted: { color: '#666' },
};
