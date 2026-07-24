'use client';

import { useState } from 'react';

/**
 * Big-screen spectator entry. Enter a game code to open the reveal/voting view
 * on any TV browser (Chromecast tab-cast, AirPlay mirror, or smart-TV browser).
 */
export default function WatchPage() {
  const [code, setCode] = useState('');
  return (
    <main>
      <h1>Watch a game</h1>
      <label>
        Game code
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          placeholder="ABC123"
        />
      </label>
      <button disabled={code.length !== 6}>Open big-screen view</button>
    </main>
  );
}
