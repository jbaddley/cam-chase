import { StatusBar } from 'expo-status-bar';
import { Linking, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { parseJoinCode } from '@photochase/shared';
import App from '../App.js';
import { session, setCryptoSource } from './auth.js';
import { unavailablePurchaseGateway, type PurchaseGateway } from './purchases.js';
import { CameraStage } from './native/CameraStage.js';
import { expoCrypto, nativeAuthorizer } from './native/auth.js';
import { nativeLocation } from './native/location.js';
import { makePurchaseGateway } from './native/purchases.js';

/**
 * The native composition root: the one place that knows about native modules.
 *
 * `App` and every screen below it take their camera, auth and store as
 * arguments, which is what keeps them renderable under the test harness. This
 * file supplies the real ones.
 */

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

// React Native has no `crypto.subtle`, so PKCE hashing comes from expo-crypto.
// Done at module load, before any screen can start a sign-in.
setCryptoSource(expoCrypto);

/**
 * The store, when there is one. A build without a RevenueCat key — every build
 * before the store products exist — still runs everything else; the plan screen
 * shows list prices and no upgrade buttons, which is honest, rather than
 * crashing at launch over a feature nobody is testing yet.
 */
const purchases: PurchaseGateway = env.EXPO_PUBLIC_REVENUECAT_KEY
  ? makePurchaseGateway(env.EXPO_PUBLIC_REVENUECAT_KEY, () => session.userId)
  : unavailablePurchaseGateway;

/**
 * Deep links into the join flow. RN's core Linking handles the app's registered
 * `photochase://` scheme (app.json), so this needs no extra native module: an
 * inbound URL — whether the app was cold-launched with it or was already running
 * — is parsed to a join code and handed up. Universal https links additionally
 * need domain verification and a prebuild, and are not wired yet.
 */
function nativeDeepLinks(onCode: (code: string) => void): () => void {
  const handle = (url: string | null) => {
    const code = url ? parseJoinCode(url) : null;
    if (code) onCode(code);
  };
  void Linking.getInitialURL().then(handle);
  const sub = Linking.addEventListener('url', ({ url }) => handle(url));
  return () => sub.remove();
}

export function PhotoChaseApp() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {/* The camera stage is outside the safe area and the controls are inside
          it. That order is the point: a viewfinder that stops short of the
          status bar is not full-bleed, and this used to inset the preview along
          with everything else. Android runs edge-to-edge, so the insets are not
          decoration — without them the top of every screen sits under the
          status bar — but they belong to the UI layer alone.

          All four edges, not just top and bottom: turned sideways, the notch
          and the navigation bar are on the left and right. */}
      <CameraStage>
        {(capture) => (
          <SafeAreaView style={styles.ui} edges={['top', 'bottom', 'left', 'right']}>
            <App
              authorize={nativeAuthorizer}
              purchases={purchases}
              capture={capture}
              location={nativeLocation}
              deepLinks={nativeDeepLinks}
            />
          </SafeAreaView>
        )}
      </CameraStage>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  /** Transparent: the preview is behind this, and a background here is what hid
      it. The app's white now sits on the camera stage, below the camera. */
  ui: { flex: 1 },
});
