import type { CaptureSource } from './screens/CaptureScreen.js';

/**
 * A capture failure the player is meant to read.
 *
 * These live here, away from the native module that raises them, so the screens
 * can recognise them without importing expo-camera or expo-location — the same
 * reason `CaptureSource` is a prop rather than an import. Before this they were
 * declared next to the camera, which put them permanently out of reach: the
 * screens could only match on `ApiError`, so every one of these carefully
 * specific messages was replaced by "Could not save that photo. Try again." The
 * message about location in particular exists to tell a player why the game
 * cannot score their shot, and nobody had ever seen it.
 */
export class CaptureError extends Error {}

export class CameraUnavailable extends CaptureError {
  constructor(message = 'The camera is not ready yet.') {
    super(message);
    this.name = 'CameraUnavailable';
  }
}

export class LocationDenied extends CaptureError {
  constructor() {
    // Location is not a nice-to-have here: a photo with no fix cannot be scored
    // for accuracy, so the game says so rather than silently scoring zero.
    super('PhotoChase needs location while a round is running, to score how close a recreation is.');
    this.name = 'LocationDenied';
  }
}

/**
 * Placeholder capture used by the scaffold. It returns a tiny in-memory blob and
 * a fixed location so the capture → upload → submit flow is exercisable end to
 * end. Replace with real expo-camera (photo) + expo-location (GPS) wiring in a
 * later phase.
 */
export const placeholderCapture: CaptureSource = async () => {
  const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
  return { file, location: { lat: 40.7128, lng: -74.006, accuracyM: 10 } };
};
