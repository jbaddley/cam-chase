import { useState } from 'react';
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
import { session, type Authorizer } from './src/auth.js';
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
}: { authorize?: Authorizer; purchases?: PurchaseGateway; capture?: CaptureSource } = {}) {
  const [signedIn, setSignedIn] = useState(session.isSignedIn);

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
  const [joined, setJoined] = useState<JoinedGame | null>(null);

  if (!signedIn) return <SignInScreen authorize={authorize} onSignedIn={() => setSignedIn(true)} />;

  if (joined) return <GameRouter joined={joined} capture={capture} onExit={() => setJoined(null)} />;

  const home = () => setRoute('home');

  switch (route) {
    case 'plan':
      return <PlanScreen onBack={home} purchases={purchases} />;
    case 'league':
      return <LeagueScreen onBack={home} />;
    case 'referral':
      return <ReferralScreen onBack={home} />;
    case 'daily':
      return <DailyHuntScreen onBack={home} />;
    case 'host':
      return (
        <HostScreen
          onHosting={(game) => {
            setRoute('home');
            setJoined(game);
          }}
          onCancel={home}
          onViewPlan={() => setRoute('plan')}
        />
      );
    case 'join':
      return (
        <JoinScreen
          onJoined={(game) => {
            setRoute('home');
            setJoined(game);
          }}
          onBack={home}
        />
      );
    default:
      return (
        <HomeScreen
          onHost={() => setRoute('host')}
          onJoin={() => setRoute('join')}
          onDailyHunt={() => setRoute('daily')}
          onLeagues={() => setRoute('league')}
          onInvite={() => setRoute('referral')}
        />
      );
  }
}

const styles = StyleSheet.create({
  configError: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  configTitle: { fontSize: 24, fontWeight: '700' },
  configBody: { fontSize: 15, color: '#495057' },
});
