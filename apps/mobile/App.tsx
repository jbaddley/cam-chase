import { useState, type ReactNode } from 'react';
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
import { DEV_FIXTURES } from './src/config.js';

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
  // With fixtures on there is no session to have; the harness exists to skip it.
  const [signedIn, setSignedIn] = useState(session.isSignedIn || DEV_FIXTURES);

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
  const [route, setRoute] = useState<Route>('home');
  /**
   * With fixtures on, start already in a game as its host. The harness exists to
   * reach the play screens, and walking home → join → code to get to them every
   * reload is the friction it was built to remove. Host, so the gate controls are
   * on screen too.
   */
  const [joined, setJoined] = useState<JoinedGame | null>(DEV_FIXTURES ? DEV_GAME : null);

  if (!signedIn) return <SignInScreen authorize={authorize} onSignedIn={() => setSignedIn(true)} />;

  /**
   * With fixtures on, the bar wraps everything — in a game or out of it — because
   * the harness drops you into a game and the only way back out was a button
   * inside it, with no way back in.
   */
  const devFrame = (node: ReactNode) =>
    DEV_FIXTURES ? (
      <View style={styles.withDevBar}>
        <DevSceneBar
          inGame={joined !== null}
          onEnterGame={() => setJoined(DEV_GAME)}
          onLeaveGame={() => setJoined(null)}
        />
        <View style={styles.devBarBody}>{node}</View>
      </View>
    ) : (
      node
    );

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
  /** Both are inert unless the fixtures are on: `DevSceneBar` renders null. */
  withDevBar: { flex: 1 },
  devBarBody: { flex: 1 },
});
