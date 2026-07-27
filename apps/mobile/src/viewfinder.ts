import { createContext, useContext, useEffect } from 'react';

/**
 * Whether the live camera preview should be running.
 *
 * A photo game is unplayable without a viewfinder — you have to see what you
 * are framing — but a camera that runs from app launch drains the battery and
 * asks for permission long before there is any reason to. So the shooting
 * screens declare when they need it, and whoever owns the camera obeys.
 *
 * The value is a plain setter rather than the camera itself, so the screens
 * stay free of native imports and keep rendering under the DOM test harness.
 * The default is a no-op: a screen mounted with no camera above it (tests, the
 * placeholder capture source) behaves exactly as it did before.
 */
export const ViewfinderContext = createContext<(active: boolean) => void>(() => {});

/**
 * Request the live preview for as long as this screen is mounted.
 *
 * Turning it off on unmount is the important half: navigating away from a
 * shooting screen must stop the camera, including when the phase poll moves the
 * player on mid-round.
 */
export function useViewfinder(active = true): void {
  const setActive = useContext(ViewfinderContext);
  useEffect(() => {
    if (!active) return;
    setActive(true);
    return () => setActive(false);
  }, [setActive, active]);
}
