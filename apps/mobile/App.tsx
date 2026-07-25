import { useCallback, useState } from 'react';
import { JoinScreen, type JoinedGame } from './src/screens/JoinScreen.js';
import { LobbyScreen } from './src/screens/LobbyScreen.js';
import { CaptureScreen } from './src/screens/CaptureScreen.js';
import { placeholderCapture } from './src/capture.js';

/**
 * Placeholder root navigation for the Phase 1 scaffold: Join → Lobby → Round 1
 * capture. A real router (Expo Router) and the rating/results flows are wired in
 * later phases.
 */
export default function App() {
  const [game, setGame] = useState<JoinedGame | null>(null);
  const [round1, setRound1] = useState<{ quota: number } | null>(null);

  const enterRound1 = useCallback((info: { quota: number }) => setRound1(info), []);

  if (!game) return <JoinScreen onJoined={setGame} />;

  // A player on a team captures in Round 1; judges/spectators stay in the lobby.
  if (round1 && game.teamId) {
    return <CaptureScreen gameId={game.gameId} teamId={game.teamId} quota={round1.quota} capture={placeholderCapture} />;
  }

  return <LobbyScreen gameId={game.gameId} code={game.code} onEnterRound1={enterRound1} />;
}
