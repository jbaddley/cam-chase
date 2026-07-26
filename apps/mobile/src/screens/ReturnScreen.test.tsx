import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const checkIn = vi.fn();
vi.mock('../api.js', () => ({ client: { checkIn: (id: string, input: unknown) => checkIn(id, input) } }));

const { ReturnScreen } = await import('./ReturnScreen.js');

afterEach(() => {
  cleanup();
  checkIn.mockReset();
});

const LOCATION = { lat: 40, lng: -74 };
const capture = () => Promise.resolve({ file: new Blob(['x']), location: LOCATION });

describe('ReturnScreen', () => {
  it('names the round it is prompting for', () => {
    render(<ReturnScreen gameId="g1" round={2} capture={capture} />);
    expect(screen.getByText('Round 2 — head back')).toBeTruthy();
  });

  it('checks in with the captured location', async () => {
    checkIn.mockResolvedValue({ round: 'round1', at: 1000 });
    render(<ReturnScreen gameId="g1" round={1} capture={capture} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(checkIn).toHaveBeenCalled());
    expect(checkIn.mock.calls[0]![0]).toBe('g1');
    expect(checkIn.mock.calls[0]![1]).toEqual({ location: LOCATION });
  });

  it('confirms once checked in and stops sending', async () => {
    checkIn.mockResolvedValue({ round: 'round1', at: 1000 });
    render(<ReturnScreen gameId="g1" round={1} capture={capture} />);

    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Checked in! Waiting for the other teams.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(checkIn).toHaveBeenCalledTimes(1));
  });

  it('surfaces the server’s message when outside the return fence', async () => {
    const { ApiError } = await import('@photochase/client');
    checkIn.mockRejectedValue(new ApiError(400, 'You are not at the return spot yet.'));
    render(<ReturnScreen gameId="g1" round={1} capture={capture} />);

    fireEvent.click(screen.getByRole('button'));

    expect(await screen.findByText('You are not at the return spot yet.')).toBeTruthy();
    // A rejected check-in must stay retryable — the team may still be walking.
    expect(screen.getByText('Check in when you reach the return spot.')).toBeTruthy();
  });

  it('falls back to a generic message on a network failure', async () => {
    checkIn.mockRejectedValue(new Error('offline'));
    render(<ReturnScreen gameId="g1" round={1} capture={capture} />);

    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('Could not check in. Try again.')).toBeTruthy();
  });
});
