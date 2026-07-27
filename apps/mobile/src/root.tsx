import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import App from '../App.js';
import { session, setCryptoSource } from './auth.js';
import { unavailablePurchaseGateway, type PurchaseGateway } from './purchases.js';
import { CameraStage } from './native/CameraStage.js';
import { expoCrypto, nativeAuthorizer } from './native/auth.js';
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

export function PhotoChaseApp() {
  return (
    <SafeAreaProvider>
      {/* Android runs edge-to-edge, so the insets are not decoration: without
          them the top of every screen sits under the status bar. */}
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <StatusBar style="auto" />
        <CameraStage>
          {(capture) => <App authorize={nativeAuthorizer} purchases={purchases} capture={capture} />}
        </CameraStage>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
});
