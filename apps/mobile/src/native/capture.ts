import * as Location from 'expo-location';
import type { CameraView } from 'expo-camera';
import type { CaptureSource } from '../screens/CaptureScreen.js';
// Raised here, declared away from the native imports so the screens can match
// on them and show what they say. See the note in `../capture.ts`.
import { CameraUnavailable, LocationDenied } from '../capture.js';

export { CameraUnavailable, LocationDenied } from '../capture.js';

/**
 * The real capture boundary: a photo from expo-camera and a fix from
 * expo-location, together, because every photo the game scores needs both.
 *
 * Kept out of the screens so they stay renderable in tests — the screens take a
 * `CaptureSource` and never import a native module.
 */

/** The camera handle the app holds; only the one method this needs is named. */
export type CameraHandle = Pick<CameraView, 'takePictureAsync'>;

/**
 * Ask for foreground location once, up front. Called before a round rather than
 * at the first shot, so the permission sheet does not interrupt a photo.
 */
export async function ensureLocationPermission(): Promise<boolean> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  return granted;
}

/**
 * Build a capture source around a mounted camera.
 *
 * The fix is read *after* the shutter rather than before, so the coordinates
 * belong to where the photo was actually taken — a player walking while the
 * camera warms up would otherwise stamp the wrong spot.
 */
export function makeCapture(getCamera: () => CameraHandle | null): CaptureSource {
  return async () => {
    const camera = getCamera();
    if (!camera) throw new CameraUnavailable();

    const shot = await camera.takePictureAsync({ quality: 0.7, skipProcessing: true });
    if (!shot?.uri) throw new CameraUnavailable('The photo could not be saved.');

    const { granted } = await Location.getForegroundPermissionsAsync();
    if (!granted) throw new LocationDenied();

    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });

    // `fetch` on a file:// URI is how RN turns a local photo into a Blob; the
    // upload path wants a Blob because it is the same shape the web app sends.
    const file = await (await fetch(shot.uri)).blob();

    return {
      file,
      location: {
        lat: fix.coords.latitude,
        lng: fix.coords.longitude,
        ...(fix.coords.accuracy !== null ? { accuracyM: fix.coords.accuracy } : {}),
      },
    };
  };
}
