import type { GeoPointInput } from '@photochase/client';

/**
 * Where the phone is, as an injected boundary.
 *
 * Screens never import native modules — the same rule that makes `CaptureSource`
 * a prop — so the walk back is driven through this and the real
 * `expo-location` calls live in `native/location.ts`.
 *
 * `watch` is separate from `current` because they are different jobs. `current`
 * is one fix on demand: the host pressing Start, a player pressing "we're back".
 * `watch` runs for the length of a walk, which is why the native implementation
 * asks for balanced rather than best accuracy — a high-accuracy subscription for
 * ten minutes is a battery hole, and the fence is wide enough to forgive it.
 */
export interface LocationSource {
  /** One fix, now. */
  current(): Promise<GeoPointInput>;
  /** Fixes as they arrive. Returns an unsubscribe. */
  watch(onFix: (fix: GeoPointInput) => void): () => void;
}

/**
 * The scaffold source: a fixed point, reported once.
 *
 * Used wherever there is no device — tests, and the app running without the
 * native root. A single fix rather than a stream, so a screen that waits for one
 * gets one and a screen that waits for movement is not fooled into thinking it
 * is moving.
 */
export const placeholderLocation: LocationSource = {
  current: () => Promise.resolve({ lat: 40.7128, lng: -74.006, accuracyM: 10 }),
  watch: (onFix) => {
    onFix({ lat: 40.7128, lng: -74.006, accuracyM: 10 });
    return () => {};
  },
};
