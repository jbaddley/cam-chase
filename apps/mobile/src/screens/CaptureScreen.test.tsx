import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const capturePhoto = vi.fn();
vi.mock('../api.js', () => ({ client: { capturePhoto: (id: string, input: unknown) => capturePhoto(id, input) } }));

const { CaptureScreen } = await import('./CaptureScreen.js');

afterEach(() => {
  cleanup();
  capturePhoto.mockReset();
});

const LOCATION = { lat: 40, lng: -74 };
const capture = () => Promise.resolve({ file: new Blob(['x']), location: LOCATION });

const takeButton = () => screen.getByRole('button');

describe('CaptureScreen', () => {
  it('starts at zero of the quota', () => {
    render(<CaptureScreen gameId="g1" teamId="t1" quota={3} capture={capture} />);
    expect(screen.getByText('0 / 3 photos')).toBeTruthy();
  });

  it('submits the captured photo for the player’s team', async () => {
    capturePhoto.mockResolvedValue({ photoId: 'p1', key: 'k' });
    render(<CaptureScreen gameId="g1" teamId="t1" quota={3} capture={capture} />);

    fireEvent.click(takeButton());

    await waitFor(() => expect(capturePhoto).toHaveBeenCalled());
    expect(capturePhoto.mock.calls[0]![0]).toBe('g1');
    expect(capturePhoto.mock.calls[0]![1]).toMatchObject({ teamId: 't1', location: LOCATION });
  });

  it('advances the counter only on success', async () => {
    capturePhoto.mockResolvedValue({ photoId: 'p1', key: 'k' });
    render(<CaptureScreen gameId="g1" teamId="t1" quota={3} capture={capture} />);

    fireEvent.click(takeButton());
    expect(await screen.findByText('1 / 3 photos')).toBeTruthy();
  });

  it('does not advance the counter when the upload fails', async () => {
    capturePhoto.mockRejectedValue(new Error('offline'));
    render(<CaptureScreen gameId="g1" teamId="t1" quota={3} capture={capture} />);

    fireEvent.click(takeButton());

    expect(await screen.findByText('Could not save that photo. Try again.')).toBeTruthy();
    // A failed upload must not consume quota, or the team loses a photo.
    expect(screen.getByText('0 / 3 photos')).toBeTruthy();
  });

  it('stops accepting captures once the quota is reached', async () => {
    capturePhoto.mockResolvedValue({ photoId: 'p1', key: 'k' });
    render(<CaptureScreen gameId="g1" teamId="t1" quota={1} capture={capture} />);

    fireEvent.click(takeButton());
    await screen.findByText('1 / 1 photos');
    expect(screen.getByText('All photos taken')).toBeTruthy();

    fireEvent.click(takeButton());
    await waitFor(() => expect(capturePhoto).toHaveBeenCalledTimes(1));
  });

  it('ignores a second tap while one capture is in flight', async () => {
    capturePhoto.mockImplementation(() => new Promise(() => {}));
    render(<CaptureScreen gameId="g1" teamId="t1" quota={5} capture={capture} />);

    fireEvent.click(takeButton());
    await screen.findByText('Saving…');
    fireEvent.click(takeButton());

    expect(capturePhoto).toHaveBeenCalledTimes(1);
  });
});
