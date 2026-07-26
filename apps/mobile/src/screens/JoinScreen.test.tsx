import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const joinGame = vi.fn();
vi.mock('../api.js', () => ({ client: { joinGame: (input: unknown) => joinGame(input) } }));

const { JoinScreen } = await import('./JoinScreen.js');

afterEach(() => {
  cleanup();
  joinGame.mockReset();
});

/** Fill the three fields with a valid join. */
function fillValidForm(code = 'abc123') {
  fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: code } });
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Reds' } });
}

describe('JoinScreen', () => {
  it('uppercases the typed code', () => {
    render(<JoinScreen onJoined={vi.fn()} />);
    const input = screen.getByPlaceholderText('ABC123') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'abc123' } });
    expect(input.value).toBe('ABC123');
  });

  it('joins with the trimmed name and creates a team', async () => {
    joinGame.mockResolvedValue({ gameId: 'g1', teamId: 't1', role: 'captain' });
    const onJoined = vi.fn();
    render(<JoinScreen onJoined={onJoined} />);

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => expect(joinGame).toHaveBeenCalled());
    expect(joinGame.mock.calls[0]![0]).toEqual({
      code: 'ABC123',
      displayName: 'Ada',
      action: { type: 'create_team', name: 'Reds' },
    });
    // The code the player typed is carried forward; the response has no code.
    expect(onJoined).toHaveBeenCalledWith({ gameId: 'g1', code: 'ABC123', teamId: 't1', role: 'captain' });
  });

  it('does nothing until every field is filled', () => {
    render(<JoinScreen onJoined={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(joinGame).not.toHaveBeenCalled();

    // A short code is still incomplete.
    fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: 'ABC12' } });
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Reds' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(joinGame).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only name', () => {
    render(<JoinScreen onJoined={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: 'ABC123' } });
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: '   ' } });
    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Reds' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(joinGame).not.toHaveBeenCalled();
  });

  it('surfaces the server’s message when the join is refused', async () => {
    const { ApiError } = await import('@photochase/client');
    joinGame.mockRejectedValue(new ApiError(400, 'Game is full.'));
    render(<JoinScreen onJoined={vi.fn()} />);

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(await screen.findByText('Game is full.')).toBeTruthy();
  });

  it('falls back to a generic message when the network fails', async () => {
    joinGame.mockRejectedValue(new Error('offline'));
    render(<JoinScreen onJoined={vi.fn()} />);

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(await screen.findByText('Could not join the game. Check your connection.')).toBeTruthy();
  });

  it('offers hosting only when the caller supplies a handler', () => {
    const { rerender } = render(<JoinScreen onJoined={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Host a game instead' })).toBeNull();

    const onHost = vi.fn();
    rerender(<JoinScreen onJoined={vi.fn()} onHost={onHost} />);
    fireEvent.click(screen.getByRole('button', { name: 'Host a game instead' }));
    expect(onHost).toHaveBeenCalled();
  });
});
