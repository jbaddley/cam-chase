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
import { CompleteProfileScreen } from './src/screens/CompleteProfileScreen.js';
import { ProfileScreen } from './src/screens/ProfileScreen.js';
import { placeholderCapture } from './src/capture.js';
import { placeholderLocation, type LocationSource } from './src/location.js';
import { session, type Authorizer } from './src/auth.js';
import { loadProfile } from './src/profile.js';
import type { ProfileView } from '@photochase/client';
import { Body, Button, Loading, Screen, Title } from './src/ui.js';
import { t } from './src/i18n.js';
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

/**
 * Subscribe to join codes arriving from a deep link (`photochase://j/<code>`);
 * returns an unsubscribe. Injected, like the camera and auth, so `App` stays free
 * of native imports — the real implementation reads them via Linking in
 * `root.tsx`. The default registers nothing.
 */
export type DeepLinkSource = (onCode: (code: string) => void) => () => void;
const noDeepLinks: DeepLinkSource = () => () => {};

/** Where the app is, outside a game. */
type Route = 'home' | 'join' | 'host' | 'plan' | 'league' | 'referral' | 'daily' | 'profile';

/**
 * Whether the signed-in user's profile has loaded yet, needs creating, or is in
 * hand. Gates the app the way sign-in does: a player with no profile completes
 * one before reaching home, because the join flow reads their display name.
 */
type ProfileState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'needed' }
  | { status: 'ready'; profile: ProfileView };

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
  deepLinks = noDeepLinks,
}: {
  authorize?: Authorizer;
  purchases?: PurchaseGateway;
  capture?: CaptureSource;
  location?: LocationSource;
  deepLinks?: DeepLinkSource;
} = {}) {
  // On when the harness has been switched on for this device this session; off
  // on every launch. See `dev/fixture-toggle.ts` for why it is no longer an env
  // flag baked into the bundle.
  const fixtures = useFixturesEnabled();
  const [signedIn, setSignedIn] = useState(session.isSignedIn);
  const [route, setRoute] = useState<Route>('home');
  const [joined, setJoined] = useState<JoinedGame | null>(null);
  const [profileState, setProfileState] = useState<ProfileState>({ status: 'loading' });
  const [reloadProfile, setReloadProfile] = useState(0);
  const [deepLinkCode, setDeepLinkCode] = useState<string | null>(null);

  /**
   * A deep link drops you into the join flow with its code ready to resolve. The
   * gates below still apply — a link tapped while signed out lands here once
   * sign-in and the profile are done, because the route is remembered.
   */
  useEffect(
    () =>
      deepLinks((code) => {
        setDeepLinkCode(code);
        setJoined(null);
        setRoute('join');
      }),
    [deepLinks],
  );

  // Signed in for real, or the harness has skipped the session.
  const authed = signedIn || fixtures;

  /**
   * Load the profile once signed in. Bumping `reloadProfile` retries after a
   * failure. A missing profile is `needed`, not an error — that is the new user
   * whose "complete your profile" form comes next.
   */
  useEffect(() => {
    if (!authed) {
      setProfileState({ status: 'loading' });
      return;
    }
    let active = true;
    setProfileState({ status: 'loading' });
    loadProfile()
      .then((profile) => {
        if (active) setProfileState(profile ? { status: 'ready', profile } : { status: 'needed' });
      })
      .catch(() => {
        if (active) setProfileState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [authed, reloadProfile]);

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

  if (!authed) {
    return devFrame(<SignInScreen authorize={authorize} onSignedIn={() => setSignedIn(true)} />);
  }

  // Identity lives with the login: a signed-in player without a profile fills one
  // in before anything else, because the join flow sends their display name.
  if (profileState.status === 'loading') {
    return devFrame(<Loading title={t('app.title')} message={t('profile.loading')} />);
  }
  if (profileState.status === 'error') {
    return devFrame(
      <Screen>
        <Title>{t('profile.title')}</Title>
        <Body muted>{t('profile.loadFailed')}</Body>
        <Button onPress={() => setReloadProfile((n) => n + 1)}>{t('profile.retry')}</Button>
      </Screen>,
    );
  }
  if (profileState.status === 'needed') {
    return devFrame(
      <CompleteProfileScreen onDone={(profile) => setProfileState({ status: 'ready', profile })} />,
    );
  }

  const displayName = profileState.profile.displayName;

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
          displayName={displayName}
          initialCode={deepLinkCode ?? undefined}
          onJoined={(game) => {
            setDeepLinkCode(null);
            setRoute('home');
            setJoined(game);
          }}
          onBack={() => {
            setDeepLinkCode(null);
            home();
          }}
        />,
      );
    case 'profile':
      return devFrame(<ProfileScreen onBack={home} />);
    default:
      return devFrame(
        <HomeScreen
          onHost={() => setRoute('host')}
          onJoin={() => setRoute('join')}
          onDailyHunt={() => setRoute('daily')}
          onLeagues={() => setRoute('league')}
          onInvite={() => setRoute('referral')}
          onProfile={() => setRoute('profile')}
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
