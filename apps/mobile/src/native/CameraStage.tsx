import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { BarcodeScanContext, CameraRectContext, DevScanContext, ViewfinderContext } from '../viewfinder.js';
import { layoutViewport, type Rect } from '../viewport.js';
import { ensureLocationPermission, makeCapture, type CameraHandle } from './capture.js';
import type { CaptureSource } from '../screens/CaptureScreen.js';

/**
 * Frozen so the native `barcodeScannerSettings` prop keeps its identity — a
 * fresh object each render churns the native side. QR only: the app scans join
 * codes and nothing else.
 */
const QR_SCANNER = { barcodeTypes: ['qr' as const] };

/**
 * Owns the camera for the whole app and hands the screens a {@link CaptureSource}.
 *
 * The preview only runs while a shooting screen asks for it through
 * {@link ViewfinderContext}, so the app does not hold the camera open — or
 * prompt for it — on the sign-in screen.
 *
 * Permissions are requested at that same moment: the first time a round needs
 * the camera, which is when the sheet's reason is obvious, rather than at
 * launch, when it is not.
 */
export function CameraStage({ children }: { children: (capture: CaptureSource) => ReactNode }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [wanted, setWanted] = useState(false);
  const [ready, setReady] = useState(false);
  const [cameraRect, setCameraRect] = useState<Rect | null>(null);
  const [scanning, setScanning] = useState(false);
  const window = useWindowDimensions();
  const camera = useRef<CameraView | null>(null);
  // The one screen currently reading a QR, if any. A ref so a scan can reach it
  // without the settings prop churning on every subscribe.
  const scanHandler = useRef<((data: string) => void) | null>(null);

  const granted = permission?.granted === true;
  const live = wanted && granted;

  // `getCamera` reports null until `onCameraReady` fires. Shooting before then
  // throws on some devices, so `makeCapture` raises CameraUnavailable — "the
  // camera is not ready yet" — and the player simply taps again.
  const capture = useMemo(
    () => makeCapture((): CameraHandle | null => (ready ? camera.current : null)),
    [ready],
  );

  const setActive = useCallback((active: boolean) => {
    setWanted(active);
    if (!active) setReady(false);
  }, []);

  // Register the one screen reading a QR; scanning is only wired to the camera
  // while a handler is present, so MLKit is not analysing frames all game.
  const subscribeScan = useCallback((onScan: (data: string) => void) => {
    scanHandler.current = onScan;
    setScanning(true);
    return () => {
      scanHandler.current = null;
      setScanning(false);
    };
  }, []);

  // `onBarcodeScanned` fires repeatedly on the same code; the handler is
  // idempotent (it disarms itself), so this just forwards every delivery.
  const handleScan = useCallback((result: { data: string }) => {
    scanHandler.current?.(result.data);
  }, []);

  // Dev-only: let the fixtures bar fire a synthetic scan at whatever is reading
  // one, so the join-by-scan path is exercisable in the emulator without a code
  // to point at. Inert unless a screen is actually scanning.
  const fireDevScan = useCallback((data: string) => {
    scanHandler.current?.(data);
  }, []);

  useEffect(() => {
    if (!wanted || granted) return;
    void requestPermission();
  }, [wanted, granted, requestPermission]);

  useEffect(() => {
    // Asked for alongside the camera, and up front rather than at the shutter:
    // a permission sheet that appears mid-photo loses the shot.
    if (live) void ensureLocationPermission();
  }, [live]);

  /**
   * The preview is a square window, not the whole screen, because every photo
   * this game takes is square — so the frame you see has to be the frame you get.
   * A shooting screen places it precisely (Round 2 hands over the exact rect for
   * its mode, computed against the space its chrome leaves); a screen that says
   * nothing gets the largest square centred in the whole window, which is Round 1.
   */
  const box =
    cameraRect ?? layoutViewport('center', { left: 0, top: 0, width: window.width, height: window.height }).camera;

  return (
    <View style={styles.stage}>
      {live ? (
        // `overflow: hidden` is what makes this a viewport rather than a hint:
        // the preview is clipped to the square, so nothing outside it is ever on
        // screen pretending to be part of the shot.
        <View style={[styles.window, { left: box.left, top: box.top, width: box.width, height: box.height }]}>
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing="back"
            onCameraReady={() => setReady(true)}
            // Only attached while a screen is reading a QR — see subscribeScan.
            {...(scanning ? { onBarcodeScanned: handleScan, barcodeScannerSettings: QR_SCANNER } : {})}
          />
        </View>
      ) : null}
      {/* Transparent, with no scrim of its own. Washing the whole window to
          keep dark text readable made the preview useless for the one thing it
          is for — seeing what you are pointing at — so the scrim moved to
          `ViewfinderFrame`, which puts it behind the words and nowhere else. */}
      <View style={styles.overlay}>
        <ViewfinderContext.Provider value={setActive}>
          <CameraRectContext.Provider value={setCameraRect}>
            <BarcodeScanContext.Provider value={subscribeScan}>
              <DevScanContext.Provider value={fireDevScan}>{children(capture)}</DevScanContext.Provider>
            </BarcodeScanContext.Provider>
          </CameraRectContext.Provider>
        </ViewfinderContext.Provider>
      </View>
      {/* Only after a real refusal — `undetermined` means the sheet is still to
          come, and covering the screen then would be a lie. */}
      {wanted && permission?.status === 'denied' ? (
        <View style={styles.denied}>
          <Text style={styles.deniedText}>
            PhotoChase needs the camera to play. {permission.canAskAgain ? '' : 'Enable it in Settings, then come back.'}
          </Text>
          {permission.canAskAgain ? (
            <Pressable onPress={() => void requestPermission()} style={styles.deniedButton}>
              <Text>Allow the camera</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * The stage carries the app's background so the screens that are not shooting
   * still sit on white. It used to live on the root view, outside the safe area;
   * it belongs here now that the camera fills the window rather than the inset.
   */
  stage: { flex: 1, backgroundColor: '#fff' },
  /** Absolute so the square can sit anywhere; clipped so it is a real viewport. */
  window: { position: 'absolute', overflow: 'hidden', backgroundColor: '#000' },
  overlay: { flex: 1 },
  denied: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    padding: 24,
    gap: 12,
    justifyContent: 'center',
  },
  deniedText: { fontSize: 16 },
  deniedButton: { backgroundColor: '#ffd43b', padding: 16, borderRadius: 12, alignItems: 'center' },
});
