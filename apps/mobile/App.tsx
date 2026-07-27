import { useState } from 'react';
import { JoinScreen, type JoinedGame } from './src/screens/JoinScreen.js';
import { LobbyScreen } from './src/screens/LobbyScreen.js';
import { CaptureScreen } from './src/screens/CaptureScreen.js';
import { ChaseScreen } from './src/screens/ChaseScreen.js';
import { RatingScreen } from './src/screens/RatingScreen.js';
import { FinalsScreen } from './src/screens/FinalsScreen.js';
import { ReturnScreen } from './src/screens/ReturnScreen.js';
import { ResultsScreen } from './src/screens/ResultsScreen.js';
import { SignInScreen } from './src/screens/SignInScreen.js';
import { HostScreen } from './src/screens/HostScreen.js';
import { PlanScreen } from './src/screens/PlanScreen.js';
import { placeholderCapture } from './src/capture.js';
import { useGamePhase } from './src/useGamePhase.js';
import { session, type Authorizer } from './src/auth.js';
import { unavailablePurchaseGateway, type PurchaseGateway } from './src/purchases.js';

/**
 * Screen selection for a joined game, driven by the polled phase. Players on a
 * team capture in Round 1 and chase in Round 2; judges and spectators stay on
 * the lobby view, which doubles as the phase display.
 */
function GameRouter({ joined }: { joined: JoinedGame }) {
  const { game, error, applyState } = useGamePhase(joined.gameId);
  const onTeam = joined.teamId !== null;
  const isHost = joined.role === 'host';

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

  if (onTeam && (game?.state === 'round1_return' || game?.state === 'round2_return')) {
    return (
      <ReturnScreen
        gameId={joined.gameId}
        round={game.state === 'round1_return' ? 1 : 2}
        capture={placeholderCapture}
      />
    );
  }

  // Judges and spectators rate too, so this is not gated on team membership.
  if (game?.state === 'rating') {
    return <RatingScreen gameId={joined.gameId} />;
  }

  if (game?.state === 'finals_voting') {
    return <FinalsScreen gameId={joined.gameId} myTeamId={joined.teamId} />;
  }

  if (game?.state === 'results' || game?.state === 'archived') {
    return <ResultsScreen gameId={joined.gameId} teams={game.teams} />;
  }

  return <LobbyScreen game={game} code={joined.code} isHost={isHost} error={error} onStarted={applyState} />;
}

/**
 * Default authorizer for environments without the native module. It fails loudly
 * instead of silently doing nothing, which would look like a broken button.
 */
const unavailableAuthorizer: Authorizer = () => {
  throw new Error('No authorizer configured. Pass expo-auth-session openAuthSessionAsync.');
};

/**
 * Placeholder root navigation for the Phase 1 scaffold: sign in → host or join
 * → the phase-driven game screens. A real router (Expo Router) lands in a later
 * phase.
 *
 * `authorize` and `purchases` are injected so the app can be driven without a
 * native build. Pass `expo-auth-session`'s `openAuthSessionAsync` and the
 * RevenueCat-backed gateway in the real client; the defaults throw rather than
 * pretending to sign anyone in or to have sold them anything.
 */
export default function App({
  authorize = unavailableAuthorizer,
  purchases = unavailablePurchaseGateway,
}: { authorize?: Authorizer; purchases?: PurchaseGateway } = {}) {
  const [signedIn, setSignedIn] = useState(session.isSignedIn);
  const [hosting, setHosting] = useState(false);
  const [viewingPlan, setViewingPlan] = useState(false);
  const [joined, setJoined] = useState<JoinedGame | null>(null);

  if (!signedIn) return <SignInScreen authorize={authorize} onSignedIn={() => setSignedIn(true)} />;

  if (joined) return <GameRouter joined={joined} />;

  if (viewingPlan) return <PlanScreen onBack={() => setViewingPlan(false)} purchases={purchases} />;

  if (hosting) {
    return (
      <HostScreen
        onHosting={(game) => {
          setHosting(false);
          setJoined(game);
        }}
        onCancel={() => setHosting(false)}
        onViewPlan={() => setViewingPlan(true)}
      />
    );
  }

  return <JoinScreen onJoined={setJoined} onHost={() => setHosting(true)} />;
}
