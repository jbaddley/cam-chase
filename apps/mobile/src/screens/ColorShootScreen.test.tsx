import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The whole reason this screen exists is that the secret is *not* in the polled
 * game state — it is fetched from a scoped endpoint so it cannot leak to the
 * other teams. If the fetch is wrong the player never learns what to shoot, and
 * nothing else in the app would notice.
 */

const getMySecret = vi.fn();
const capturePhoto = vi.fn();
vi.mock('../api.js', () => ({
  client: {
    getMySecret: (id: string) => getMySecret(id),
    capturePhoto: (id: string, input: unknown) => capturePhoto(id, input),
  },
}));

const { ColorShootScreen } = await import('./ColorShootScreen.js');

afterEach(() => {
  cleanup();
  [getMySecret, capturePhoto].forEach((m) => m.mockReset());
});

const capture = () => Promise.resolve({ file: new Blob(['x']), location: { lat: 0, lng: 0 } });

const show = () =>
  render(<ColorShootScreen gameId="g1" teamId="t1" quota={5} capture={capture} />);

describe('ColorShootScreen', () => {
  it('shows the secret this team was dealt', async () => {
    getMySecret.mockResolvedValue({ description: 'a red circle' });
    show();

    expect(await screen.findByText('Your secret: a red circle')).toBeTruthy();
    expect(getMySecret).toHaveBeenCalledWith('g1');
  });

  it('shoots through the ordinary capture flow', async () => {
    getMySecret.mockResolvedValue({ description: 'green' });
    show();

    // The shooting half is the chase's capture screen, quota and all.
    expect(await screen.findByText('0 / 5 photos')).toBeTruthy();
  });

  it('says the secrets are not dealt yet rather than showing a blank brief', async () => {
    // Landing here a moment before the round starts is normal, not an error.
    getMySecret.mockRejectedValue(new Error('too early'));
    show();

    expect(await screen.findByText('Secrets have not been dealt yet.')).toBeTruthy();
  });
});
