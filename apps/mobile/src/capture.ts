import type { CaptureSource } from './screens/CaptureScreen.js';

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
