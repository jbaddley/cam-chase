'use client';

import { use, useEffect, useState } from 'react';
import type { SpectatorView } from '@photochase/client';
import type { MessageKey } from '@photochase/i18n';
import { client } from '../../api.js';
import { useT } from '../../i18n.js';

const POLL_MS = 3000;

/** Catalog key per phase, so the big screen follows the viewer's language. */
const PHASE_KEY = {
  draft: 'phase.draft',
  lobby: 'phase.lobby',
  round1_active: 'phase.round1Active',
  round1_return: 'phase.round1Return',
  round2_active: 'phase.round2Active',
  round2_return: 'phase.round2Return',
  guessing: 'phase.guessing',
  scatter: 'phase.scatter',
  tag_active: 'phase.tagActive',
  rating: 'phase.rating',
  finals_voting: 'phase.finalsVoting',
  results: 'phase.results',
  archived: 'phase.archived',
} as const satisfies Record<SpectatorView['game']['state'], MessageKey>;

/**
 * Live big-screen view for a game code. Polls the public spectator endpoint, so
 * it needs no sign-in and can be cast to any TV browser.
 */
export default function BigScreenPage({ params }: { params: Promise<{ code: string }> }) {
  const code = use(params).code.toUpperCase();
  const [view, setView] = useState<SpectatorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  useEffect(() => {
    let active = true;

    async function refresh(): Promise<void> {
      try {
        const next = await client.spectate(code);
        if (!active) return;
        setView(next);
        setError(null);
      } catch {
        if (active) setError('unreachable');
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
        <p style={styles.phase}>{error ? t('watch.unreachable') : t('watch.connecting')}</p>
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
      <p style={styles.phase}>{t(PHASE_KEY[game.state])}</p>
      {error ? <p style={styles.error}>{t('watch.unreachable')}</p> : null}

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
                {t('lobby.playerCount', { count: team.memberCount })}
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
