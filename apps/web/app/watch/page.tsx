'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '../i18n.js';

/**
 * Big-screen spectator entry. Enter a game code to open the reveal/voting view
 * on any TV browser (Chromecast tab-cast, AirPlay mirror, or smart-TV browser).
 */
export default function WatchPage() {
  const [code, setCode] = useState('');
  const router = useRouter();
  const t = useT();
  const ready = code.length === 6;
  const open = () => ready && router.push(`/watch/${code}`);

  return (
    <main>
      <h1>{t('watch.title')}</h1>
      <label>
        {t('watch.gameCode')}
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && open()}
          maxLength={6}
          placeholder="ABC123"
        />
      </label>
      <button disabled={!ready} onClick={open}>
        {t('watch.open')}
      </button>
    </main>
  );
}
