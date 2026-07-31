'use client';

import { use, useEffect, useState } from 'react';
import type { SpectatorView } from '@photochase/client';
import type { MessageKey } from '@photochase/i18n';
import { client } from '../../api.js';
import { useT } from '../../i18n.js';

/** Catalog key per phase, mirroring the big-screen viewer. */
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
 * Where a lobby QR (and a shared link) lands: `photochase.app/j/<code>`.
 *
 * Whoever already has the app scans the same QR in-app and joins directly; this
 * page is for the phone camera that opened a browser instead. It confirms the
 * game is real, shows the code big enough to type into the app, and points at
 * the big screen. Tapping through to open the app and auto-join waits on the
 * app's deep-link handling, which does not exist yet — so nothing here promises
 * it.
 */
export default function JoinLinkPage({ params }: { params: Promise<{ code: string }> }) {
  const code = use(params).code.toUpperCase();
  const [status, setStatus] = useState<'loading' | 'found' | 'notfound'>('loading');
  const [view, setView] = useState<SpectatorView | null>(null);
  const t = useT();

  useEffect(() => {
    let active = true;
    client
      .spectate(code)
      .then((next) => {
        if (!active) return;
        setView(next);
        setStatus('found');
      })
      .catch(() => {
        if (active) setStatus('notfound');
      });
    return () => {
      active = false;
    };
  }, [code]);

  return (
    <main style={styles.main}>
      <p style={styles.kicker}>{t('app.title')}</p>
      <h1 style={styles.heading}>{t('joinLink.invited')}</h1>

      <div style={styles.codeBlock}>
        <span style={styles.codeLabel}>{t('lobby.codeLabel')}</span>
        <span style={styles.code}>{code}</span>
      </div>

      {status === 'loading' ? <p style={styles.muted}>{t('watch.connecting')}</p> : null}
      {status === 'notfound' ? <p style={styles.error}>{t('joinLink.notFound')}</p> : null}
      {status === 'found' && view ? (
        <p style={styles.muted}>
          {t(PHASE_KEY[view.game.state])} · {t('lobby.teamsJoined', { count: view.game.teams.length })}
        </p>
      ) : null}

      <p style={styles.instruction}>{t('joinLink.useApp')}</p>

      <p>
        <a href={`/watch/${code}`} style={styles.link}>
          {t('watch.open')} &rarr;
        </a>
      </p>
    </main>
  );
}

/** Inline styles keep the page self-contained until the design system lands. */
const styles: Record<string, React.CSSProperties> = {
  main: { padding: '6vh 8vw', fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '0 auto' },
  kicker: { textTransform: 'uppercase', letterSpacing: '0.15em', color: '#1971c2', fontWeight: 700, margin: 0 },
  heading: { fontSize: '2rem', margin: '0.25em 0 1em' },
  codeBlock: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '4vh 0' },
  codeLabel: { textTransform: 'uppercase', letterSpacing: '0.1em', color: '#666', fontSize: '0.9rem' },
  code: { fontSize: '3rem', fontWeight: 800, letterSpacing: '0.2em' },
  muted: { color: '#666', textAlign: 'center' },
  error: { color: '#c92a2a', textAlign: 'center' },
  instruction: { fontSize: '1.1rem', textAlign: 'center', marginTop: '2vh' },
  link: { color: '#1971c2' },
};
