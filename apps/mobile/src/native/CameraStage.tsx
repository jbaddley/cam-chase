import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ViewfinderContext } from '../viewfinder.js';
import { ensureLocationPermission, makeCapture, type CameraHandle } from './capture.js';
import type { CaptureSource } from '../screens/CaptureScreen.js';

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
  const camera = useRef<CameraView | null>(null);

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

  useEffect(() => {
    if (!wanted || granted) return;
    void requestPermission();
  }, [wanted, granted, requestPermission]);

  useEffect(() => {
    // Asked for alongside the camera, and up front rather than at the shutter:
    // a permission sheet that appears mid-photo loses the shot.
    if (live) void ensureLocationPermission();
  }, [live]);

  return (
    <View style={styles.stage}>
      {live ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          onCameraReady={() => setReady(true)}
        />
      ) : null}
      {/* A scrim only while the preview is behind it, so the screens' dark text
          stays readable over whatever the player is pointing at. */}
      <View style={live ? styles.overlayOverCamera : styles.overlay}>
        <ViewfinderContext.Provider value={setActive}>{children(capture)}</ViewfinderContext.Provider>
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
  stage: { flex: 1 },
  overlay: { flex: 1 },
  overlayOverCamera: { flex: 1, backgroundColor: 'rgba(255,255,255,0.55)' },
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
