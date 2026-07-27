import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These three variables are the difference between an app that works and one
 * that shows "Invalid client id" from Cognito. They are inlined at bundle time,
 * so a development build running off a local Metro server has whatever that
 * machine's `.env` holds — not what `eas.json` says. Getting it wrong is easy;
 * being told about it is the point of this module.
 */

const ENV = {
  EXPO_PUBLIC_API_URL: 'https://api.example.com',
  EXPO_PUBLIC_AUTH_DOMAIN: 'https://auth.example.com',
  EXPO_PUBLIC_USER_POOL_CLIENT_ID: 'client-123',
};

/** Load a fresh copy of the module against a given environment. */
async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.stubGlobal('process', { env });
  return import('./config.js');
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('config', () => {
  it('reads all three when they are set', async () => {
    const config = await load(ENV);
    expect(config.API_URL).toBe('https://api.example.com');
    expect(config.USER_POOL_CLIENT_ID).toBe('client-123');
    expect(config.configError).toBeNull();
  });

  it('names every missing variable, not just the first', async () => {
    const config = await load({});
    expect(config.missingConfig).toEqual([
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_AUTH_DOMAIN',
      'EXPO_PUBLIC_USER_POOL_CLIENT_ID',
    ]);
  });

  it('treats a blank value as missing', async () => {
    // An empty `env:` entry in eas.json is a mistake, and inlining "" would
    // send Cognito an empty client id — the same failure with no explanation.
    const config = await load({ ...ENV, EXPO_PUBLIC_USER_POOL_CLIENT_ID: '   ' });
    expect(config.USER_POOL_CLIENT_ID).toBeNull();
    expect(config.missingConfig).toEqual(['EXPO_PUBLIC_USER_POOL_CLIENT_ID']);
  });

  it('tells the reader how to fix it, for both ways of running', async () => {
    const config = await load({});
    expect(config.configError).toContain('.env.example');
    expect(config.configError).toContain('eas.json');
  });

  it('does not require the RevenueCat key', async () => {
    // Purchases are genuinely optional; the app runs and sells nothing.
    const config = await load(ENV);
    expect(config.REVENUECAT_KEY).toBeNull();
    expect(config.configError).toBeNull();
  });
});
