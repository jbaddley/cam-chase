import { useSyncExternalStore } from 'react';

/**
 * A runtime, per-device, in-memory switch for the fixture harness.
 *
 * The switch used to be `EXPO_PUBLIC_DEV_FIXTURES`, read when Metro built the
 * bundle. Metro serves one bundle to every device, so a developer's `.env`
 * turned the harness on for every phone loading from that Metro — including a
 * real player's on the same network, pointed at the fake API without a hint.
 * It cost an afternoon twice.
 *
 * This can only be turned on by a tap on the device itself, it lives in memory
 * only, and it is off on every launch. So a reload never silently points a
 * phone at fixtures, and no environment variable or build profile can turn it
 * on at all — the only way in is a deliberate, per-session, per-device tap.
 *
 * `__DEV__` still gates it, exactly as the env flag's first half did: a release
 * bundle cannot enable the harness however {@link setFixturesEnabled} is called,
 * so it cannot appear in anything a player could install.
 */

let enabled = false;
const listeners = new Set<() => void>();

/**
 * Whether this is a development bundle, evaluated each call rather than captured
 * at import so a test can stub `__DEV__` before exercising the on path. `__DEV__`
 * never changes at runtime, so calling it repeatedly costs nothing.
 */
function devBundle(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

/** Whether the harness *can* be enabled here — development bundles only. */
export function fixturesAvailable(): boolean {
  return devBundle();
}

/** Whether the harness is answering requests right now. Never true in a release bundle. */
export function fixturesEnabled(): boolean {
  return devBundle() && enabled;
}

/**
 * Turn the harness on or off. A no-op in any non-development bundle, so a release
 * build stays on the real API however this is called.
 */
export function setFixturesEnabled(on: boolean): void {
  if (!devBundle()) return;
  if (enabled === on) return;
  enabled = on;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding: re-renders the subscriber whenever the harness is toggled. */
export function useFixturesEnabled(): boolean {
  return useSyncExternalStore(subscribe, fixturesEnabled, () => false);
}
