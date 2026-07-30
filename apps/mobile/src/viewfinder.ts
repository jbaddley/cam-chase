import { createContext, useContext, useEffect } from 'react';
import type { CameraPlacement } from './viewport.js';

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

/**
 * Subscribe a handler to QR scans for as long as a screen wants to read one.
 *
 * The camera owner runs the barcode scanner only while a handler is registered,
 * so MLKit is not analysing every frame for the whole game — the same "declare
 * it and the owner obeys" shape as {@link ViewfinderContext}, and the same
 * reason: a screen never imports the camera, so it still renders under the DOM
 * test harness with a fake subscriber. The subscribe function returns an
 * unsubscribe; the default is a no-op that registers nothing.
 */
export const BarcodeScanContext = createContext<(onScan: (data: string) => void) => () => void>(
  () => () => {},
);

/**
 * Read a QR scan while `active`, turning the preview on for as long as it lasts.
 *
 * `onScan` should be stable (memoise it) — it re-subscribes when it changes. It
 * must also be idempotent: `onBarcodeScanned` fires repeatedly on the same code,
 * so the caller disarms itself (navigates away, or a `done` guard) rather than
 * relying on a single delivery.
 */
export function useBarcodeScan(onScan: (data: string) => void, active = true): void {
  const subscribe = useContext(BarcodeScanContext);
  useViewfinder(active);
  useEffect(() => {
    if (!active) return;
    return subscribe(onScan);
  }, [subscribe, onScan, active]);
}

/**
 * Dev-only channel to fire a synthetic scan at whatever screen is reading one,
 * so the fixtures bar can exercise the join-by-scan path in the emulator with no
 * code to point a camera at. The default is a no-op.
 */
export const DevScanContext = createContext<(data: string) => void>(() => {});

/**
 * Whether the frame arranged itself sideways.
 *
 * `ViewfinderFrame` already decides this — `landscape ?? width > height` — and
 * then dropped it, so a child that needs the answer had no way to ask. Side by
 * side is the case in point: it is only an arrangement worth offering when the
 * phone is turned, and the screen offering it sits inside the frame that knows.
 *
 * A context rather than a prop for the same reason the viewfinder setter is one:
 * whoever needs it reads it, without every layer in between threading it
 * through. The default is portrait so the hook is safe outside a frame.
 */
export const ViewfinderLayoutContext = createContext<{ landscape: boolean }>({ landscape: false });

export function useViewfinderLayout(): { landscape: boolean } {
  return useContext(ViewfinderLayoutContext);
}

/**
 * Where the square preview should sit.
 *
 * Every photo is square, so the preview is a square window rather than the whole
 * screen — and a screen showing the original *beside* the camera has to move that
 * window out of the way. Declared by the screen and obeyed by whoever owns the
 * camera, the same shape as {@link ViewfinderContext}, because the alternative is
 * a screen reaching into the camera to reposition it.
 *
 * The default is centred: a screen that never says anything gets the largest
 * square the window holds, which is what Round 1 wants.
 */
export const CameraPlacementContext = createContext<(placement: CameraPlacement) => void>(() => {});

/** Ask for a placement for as long as this screen wants it. */
export function useCameraPlacement(placement: CameraPlacement): void {
  const setPlacement = useContext(CameraPlacementContext);
  useEffect(() => {
    setPlacement(placement);
    // Back to centred on the way out, so the next screen is not left holding a
    // split layout it never asked for.
    return () => setPlacement('center');
  }, [setPlacement, placement]);
}
