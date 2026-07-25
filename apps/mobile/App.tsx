import { useState } from 'react';
import { JoinScreen, type JoinedGame } from './src/screens/JoinScreen.js';
import { LobbyScreen } from './src/screens/LobbyScreen.js';
import { CaptureScreen } from './src/screens/CaptureScreen.js';
import { ChaseScreen } from './src/screens/ChaseScreen.js';
import { RatingScreen } from './src/screens/RatingScreen.js';
import { ResultsScreen } from './src/screens/ResultsScreen.js';
import { placeholderCapture } from './src/capture.js';
import { useGamePhase } from './src/useGamePhase.js';

/**
 * Screen selection for a joined game, driven by the polled phase. Players on a
 * team capture in Round 1 and chase in Round 2; judges and spectators stay on
 * the lobby view, which doubles as the phase display.
 */
function GameRouter({ joined }: { joined: JoinedGame }) {
  const { game, error, applyState } = useGamePhase(joined.gameId);
  const onTeam = joined.teamId !== null;

  if (onTeam && game?.state === 'round1_active') {
    return (
      <CaptureScreen
        gameId={joined.gameId}
        teamId={joined.teamId!}
        quota={game.config.photosPerRound}
        capture={placeholderCapture}
      />
    );
  }

  if (onTeam && game?.state === 'round2_active') {
    return <ChaseScreen gameId={joined.gameId} teamId={joined.teamId!} capture={placeholderCapture} />;
  }

  // Judges and spectators rate too, so this is not gated on team membership.
  if (game?.state === 'rating') {
    return <RatingScreen gameId={joined.gameId} />;
  }

  if (game?.state === 'results' || game?.state === 'archived') {
    return <ResultsScreen gameId={joined.gameId} teams={game.teams} />;
  }

  return <LobbyScreen game={game} code={joined.code} error={error} onStarted={applyState} />;
}

/**
 * Placeholder root navigation for the Phase 1 scaffold: Join → Lobby → Round 1
 * capture → Round 2 chase. A real router (Expo Router) and the rating/results
 * flows are wired in later phases.
 */
export default function App() {
  const [joined, setJoined] = useState<JoinedGame | null>(null);

  if (!joined) return <JoinScreen onJoined={setJoined} />;
  return <GameRouter joined={joined} />;
}
