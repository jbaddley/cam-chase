import * as Location from 'expo-location';
import type { LocationSource } from '../location.js';
import { LocationDenied } from '../capture.js';
import { ensureLocationPermission } from './capture.js';

/**
 * The real location boundary. The only file that knows `expo-location` has a
 * watch API at all, exactly as `CameraStage` is the only file that knows
 * `CameraView`.
 *
 * No new permission: `app.json` already declares fine and coarse location for
 * photo stamping, and a foreground watch needs nothing beyond them. Background
 * location would — and is deliberately not used, because it would mean a
 * foreground service, a store review conversation, and tracking players between
 * games to solve a problem that only exists while a screen is open.
 */
export const nativeLocation: LocationSource = {
  async current() {
    if (!(await ensureLocationPermission())) throw new LocationDenied();
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return toPoint(fix);
  },

  watch(onFix) {
    let stop: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      if (!(await ensureLocationPermission())) return;
      const sub = await Location.watchPositionAsync(
        {
          // Balanced, not High: this runs for the whole walk back, and the fence
          // is 75 m wide — it does not care about the last few metres.
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 10_000,
          distanceInterval: 15,
        },
        (fix) => onFix(toPoint(fix)),
      );
      // Unsubscribing may be requested before the subscription resolves, which
      // happens whenever a player leaves the screen quickly.
      if (cancelled) sub.remove();
      else stop = () => sub.remove();
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  },
};

function toPoint(fix: Location.LocationObject) {
  return {
    lat: fix.coords.latitude,
    lng: fix.coords.longitude,
    ...(fix.coords.accuracy !== null ? { accuracyM: fix.coords.accuracy } : {}),
  };
}
