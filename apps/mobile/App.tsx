import { useState } from 'react';
import { JoinScreen, type JoinedGame } from './src/screens/JoinScreen.js';
import { LobbyScreen } from './src/screens/LobbyScreen.js';

/**
 * Placeholder root navigation for the Phase 1 scaffold: Join → Lobby. A real
 * router (Expo Router) and the camera/rating flows are wired in later phases.
 */
export default function App() {
  const [game, setGame] = useState<JoinedGame | null>(null);

  if (!game) return <JoinScreen onJoined={setGame} />;
  return <LobbyScreen gameId={game.gameId} code={game.code} />;
}
