'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Big-screen spectator entry. Enter a game code to open the reveal/voting view
 * on any TV browser (Chromecast tab-cast, AirPlay mirror, or smart-TV browser).
 */
export default function WatchPage() {
  const [code, setCode] = useState('');
  const router = useRouter();
  const ready = code.length === 6;
  const open = () => ready && router.push(`/watch/${code}`);

  return (
    <main>
      <h1>Watch a game</h1>
      <label>
        Game code
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && open()}
          maxLength={6}
          placeholder="ABC123"
        />
      </label>
      <button disabled={!ready} onClick={open}>
        Open big-screen view
      </button>
    </main>
  );
}
