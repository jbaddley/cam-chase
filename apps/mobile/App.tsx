import { useState } from 'react';
import { JoinScreen } from './src/screens/JoinScreen.js';
import { LobbyScreen, type LobbyTeam } from './src/screens/LobbyScreen.js';

/**
 * Placeholder root navigation for the Phase 1 scaffold: Join → Lobby. A real
 * router (Expo Router) and the camera/rating flows are wired in later phases.
 */
export default function App() {
  const [code, setCode] = useState<string | null>(null);
  const teams: LobbyTeam[] = [];

  if (!code) return <JoinScreen onJoin={setCode} />;
  return <LobbyScreen code={code} teams={teams} />;
}
