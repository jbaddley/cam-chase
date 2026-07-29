import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixturesAvailable, fixturesEnabled, setFixturesEnabled } from './fixture-toggle.js';

/**
 * The harness must be off on every launch and impossible to turn on outside a
 * development bundle — that is the whole reason it stopped being an env flag
 * baked into the one bundle Metro serves every device. Under vitest `__DEV__` is
 * undefined, which stands in for a release bundle; stubbing it true stands in
 * for the dev client.
 */
afterEach(() => {
  // Clear the in-memory flag while still a dev bundle (setFixturesEnabled is a
  // no-op once the stub is gone), then drop the stub so the next test starts as
  // a release bundle again.
  vi.stubGlobal('__DEV__', true);
  setFixturesEnabled(false);
  vi.unstubAllGlobals();
});

describe('the fixture toggle', () => {
  it('is off, and cannot be turned on, in a non-development bundle', () => {
    // No `__DEV__` stub: this is a release bundle.
    expect(fixturesAvailable()).toBe(false);
    expect(fixturesEnabled()).toBe(false);

    setFixturesEnabled(true);

    // The guard held: a release build stays on the real API however this is called.
    expect(fixturesEnabled()).toBe(false);
  });

  it('is still off by default in a development bundle', () => {
    vi.stubGlobal('__DEV__', true);

    expect(fixturesAvailable()).toBe(true);
    expect(fixturesEnabled()).toBe(false);
  });

  it('turns on and off only when deliberately toggled', () => {
    vi.stubGlobal('__DEV__', true);

    setFixturesEnabled(true);
    expect(fixturesEnabled()).toBe(true);

    setFixturesEnabled(false);
    expect(fixturesEnabled()).toBe(false);
  });

  it('a flag left on in dev still reads off once the bundle is not dev', () => {
    vi.stubGlobal('__DEV__', true);
    setFixturesEnabled(true);
    expect(fixturesEnabled()).toBe(true);

    // Same in-memory flag, but no longer a dev bundle — as a release build reads it.
    vi.unstubAllGlobals();
    expect(fixturesEnabled()).toBe(false);
  });
});
