import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { configError } from './src/config.js';
import { GameRouter } from './src/GameRouter.js';
import { DailyHuntScreen } from './src/screens/DailyHuntScreen.js';
import { HomeScreen } from './src/screens/HomeScreen.js';
import { JoinScreen, type JoinedGame } from './src/screens/JoinScreen.js';
import { LeagueScreen } from './src/screens/LeagueScreen.js';
import { PlanScreen } from './src/screens/PlanScreen.js';
import { ReferralScreen } from './src/screens/ReferralScreen.js';
import { SignInScreen } from './src/screens/SignInScreen.js';
import { HostScreen } from './src/screens/HostScreen.js';
import { placeholderCapture } from './src/capture.js';
import { placeholderLocation, type LocationSource } from './src/location.js';
import { session, type Authorizer } from './src/auth.js';
import { fixturesAvailable, setFixturesEnabled, useFixturesEnabled } from './src/dev/fixture-toggle.js';

/** The game the harness drops you into: host, so the gate controls are on screen. */
const DEV_GAME: JoinedGame = { gameId: 'game_dev', code: 'DEV123', teamId: 'team_dev', role: 'host' };
import { DevSceneBar } from './src/dev/DevSceneBar.js';
import { unavailablePurchaseGateway, type PurchaseGateway } from './src/purchases.js';
import type { CaptureSource } from './src/screens/CaptureScreen.js';

/**
 * Default authorizer for environments without the native module. It fails loudly
 * instead of silently doing nothing, which would look like a broken button.
 */
const unavailableAuthorizer: Authorizer = () => {
  throw new Error('No authorizer configured. Pass expo-auth-session openAuthSessionAsync.');
};

/** Where the app is, outside a game. */
type Route = 'home' | 'join' | 'host' | 'plan' | 'league' | 'referral' | 'daily';

/**
 * Root navigation: sign in → home → host, join, or one of the solo/social
 * surfaces. Inside a game, {@link GameRouter} takes over and picks the screen
 * from the polled phase and the game's mode.
 *
 * `authorize`, `purchases` and `capture` are injected so the app can be driven
 * without a native build — the defaults throw or return a fixture rather than
 * pretending to sign anyone in, sell them anything, or take a photograph.
 */
export default function App({
  authorize = unavailableAuthorizer,
  purchases = unavailablePurchaseGateway,
  capture = placeholderCapture,
  location = placeholderLocation,
}: {
  authorize?: Authorizer;
  purchases?: PurchaseGateway;
  capture?: CaptureSource;
  location?: LocationSource;
} = {}) {
  // On when the harness has been switched on for this device this session; off
  // on every launch. See `dev/fixture-toggle.ts` for why it is no longer an env
  // flag baked into the bundle.
  const fixtures = useFixturesEnabled();
  const [signedIn, setSignedIn] = useState(session.isSignedIn);
  const [route, setRoute] = useState<Route>('home');
  const [joined, setJoined] = useState<JoinedGame | null>(null);

  /**
   * Flipping the harness on drops you straight into a game as its host — the play
   * screens are what it exists to reach, and there is no join code to reach one
   * otherwise. Flipping it off drops you back out, so a fake game id never gets
   * pointed at the real API. Only on the transition, so the bar's leave/enter can
   * move you around freely while it stays on.
   */
  useEffect(() => {
    setJoined(fixtures ? DEV_GAME : null);
  }, [fixtures]);

  // Before anything else: an app pointed at nothing cannot sign anyone in, and
  // the failure it produces otherwise ("Invalid client id" from Cognito, or a
  // connection refused) points nowhere near the missing variable.
  if (configError) {
    return (
      <View style={styles.configError}>
        <Text style={styles.configTitle}>Not configured</Text>
        <Text style={styles.configBody}>{configError}</Text>
      </View>
    );
  }

  /**
   * In a development bundle the bar wraps everything — even the sign-in screen,
   * so the harness can be switched on before there is a session, and even out of
   * a game, so the home routes stay reachable after the harness drops you into
   * one. Absent entirely from any release bundle: {@link fixturesAvailable} is
   * `__DEV__`.
   */
  const devFrame = (node: ReactNode) =>
    fixturesAvailable() ? (
      <View style={styles.withDevBar}>
        <DevSceneBar
          enabled={fixtures}
          onToggle={() => setFixturesEnabled(!fixtures)}
          inGame={joined !== null}
          onEnterGame={() => setJoined(DEV_GAME)}
          onLeaveGame={() => setJoined(null)}
        />
        <View style={styles.devBarBody}>{node}</View>
      </View>
    ) : (
      node
    );

  // Signed in for real, or the harness has skipped the session.
  if (!(signedIn || fixtures)) {
    return devFrame(<SignInScreen authorize={authorize} onSignedIn={() => setSignedIn(true)} />);
  }

  if (joined) {
    return devFrame(
      <GameRouter joined={joined} capture={capture} location={location} onExit={() => setJoined(null)} />,
    );
  }

  const home = () => setRoute('home');

  switch (route) {
    case 'plan':
      return devFrame(<PlanScreen onBack={home} purchases={purchases} />);
    case 'league':
      return devFrame(<LeagueScreen onBack={home} />);
    case 'referral':
      return devFrame(<ReferralScreen onBack={home} />);
    case 'daily':
      return devFrame(<DailyHuntScreen onBack={home} />);
    case 'host':
      return devFrame(
        <HostScreen
          onHosting={(game) => {
            setRoute('home');
            setJoined(game);
          }}
          onCancel={home}
          onViewPlan={() => setRoute('plan')}
        />,
      );
    case 'join':
      return devFrame(
        <JoinScreen
          onJoined={(game) => {
            setRoute('home');
            setJoined(game);
          }}
          onBack={home}
        />,
      );
    default:
      return devFrame(
        <HomeScreen
          onHost={() => setRoute('host')}
          onJoin={() => setRoute('join')}
          onDailyHunt={() => setRoute('daily')}
          onLeagues={() => setRoute('league')}
          onInvite={() => setRoute('referral')}
        />,
      );
  }
}

const styles = StyleSheet.create({
  configError: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  configTitle: { fontSize: 24, fontWeight: '700' },
  configBody: { fontSize: 15, color: '#495057' },
  /** The frame is present in dev; `DevSceneBar` is a thin strip until switched on. */
  withDevBar: { flex: 1 },
  devBarBody: { flex: 1 },
});
