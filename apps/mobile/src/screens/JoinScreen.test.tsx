import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const joinGame = vi.fn();
const spectate = vi.fn();
vi.mock('../api.js', () => ({
  client: { joinGame: (input: unknown) => joinGame(input), spectate: (code: string) => spectate(code) },
}));

const { JoinScreen } = await import('./JoinScreen.js');

afterEach(() => {
  cleanup();
  [joinGame, spectate].forEach((m) => m.mockReset());
});

/** The public peek the screen uses to learn a game's mode before joining. */
const asMode = (mode: string) => spectate.mockResolvedValue({ game: { config: { mode } } });

beforeEach(() => asMode('photo_chase'));

/** Render with a signed-in display name, which now comes from the profile. */
function renderJoin(props: Record<string, unknown> = {}) {
  return render(<JoinScreen displayName="Ada" onJoined={vi.fn()} {...props} />);
}

/** Fill the code and team-name fields with a valid join. */
function fillValidForm(code = 'abc123') {
  fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: code } });
  fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Reds' } });
}

describe('JoinScreen', () => {
  it('uppercases the typed code', () => {
    renderJoin();
    const input = screen.getByPlaceholderText('ABC123') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'abc123' } });
    expect(input.value).toBe('ABC123');
  });

  it('has no "your name" field — identity comes from the profile', () => {
    renderJoin();
    expect(screen.queryByPlaceholderText('Your name')).toBeNull();
  });

  it('joins with the profile display name and creates a team', async () => {
    joinGame.mockResolvedValue({ gameId: 'g1', teamId: 't1', role: 'captain' });
    const onJoined = vi.fn();
    renderJoin({ onJoined });

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

  it('names what is missing instead of joining silently', () => {
    // The reported bug: pressing Join with the form incomplete did nothing at
    // all. The action now says why it is blocked, first unmet requirement first.
    renderJoin();
    expect(screen.getByRole('button', { name: 'Enter the 6-character code' })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: 'ABC12' } });
    expect(screen.getByRole('button', { name: 'Enter the 6-character code' })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: 'ABC123' } });
    expect(screen.getByRole('button', { name: 'Name your team' })).toBeTruthy();

    // Pressing the blocked action does nothing but keep saying why.
    fireEvent.click(screen.getByRole('button', { name: 'Name your team' }));
    expect(joinGame).not.toHaveBeenCalled();
  });

  it('blocks a whitespace-only team name and flags the field on blur', () => {
    renderJoin();
    fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: 'ABC123' } });
    const team = screen.getByPlaceholderText('Team name');
    fireEvent.change(team, { target: { value: '   ' } });
    fireEvent.blur(team);

    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Name your team' })).toBeTruthy();
    expect(joinGame).not.toHaveBeenCalled();
  });

  it('surfaces the server’s message when the join is refused', async () => {
    const { ApiError } = await import('@photochase/client');
    joinGame.mockRejectedValue(new ApiError(400, 'Game is full.'));
    renderJoin();

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(await screen.findByText('Game is full.')).toBeTruthy();
  });

  it('falls back to a generic message when the network fails', async () => {
    joinGame.mockRejectedValue(new Error('offline'));
    renderJoin();

    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(await screen.findByText('Could not join the game. Check your connection.')).toBeTruthy();
  });

  it('offers a way back only when the caller supplies one', () => {
    const { rerender } = renderJoin();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();

    const onBack = vi.fn();
    rerender(<JoinScreen displayName="Ada" onJoined={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('JoinScreen — tag consent', () => {
  it('asks for the photography acknowledgement only in a tag game', async () => {
    asMode('photo_tag');
    renderJoin();
    fillValidForm();

    expect(
      await screen.findByText('Other players will photograph you during this game.'),
    ).toBeTruthy();
  });

  it('asks nobody joining a chase', async () => {
    renderJoin();
    fillValidForm();

    await waitFor(() => expect(spectate).toHaveBeenCalled());
    expect(screen.queryByText('Other players will photograph you during this game.')).toBeNull();
  });

  it('will not join a tag game until the player agrees', async () => {
    asMode('photo_tag');
    renderJoin();
    fillValidForm();
    await screen.findByText('Other players will photograph you during this game.');

    // Blocked on the acknowledgement, and the action says so rather than joining.
    expect(screen.getByRole('button', { name: 'Agree to be photographed' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Agree to be photographed' }));
    expect(joinGame).not.toHaveBeenCalled();
  });

  it('sends the acknowledgement once given', async () => {
    asMode('photo_tag');
    joinGame.mockResolvedValue({ gameId: 'g1', teamId: 't1', role: 'captain' });
    renderJoin();
    fillValidForm();
    await screen.findByText('Other players will photograph you during this game.');

    fireEvent.click(screen.getByRole('button', { name: 'I agree' }));
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => expect(joinGame).toHaveBeenCalled());
    expect(joinGame.mock.calls[0]![0]).toMatchObject({ acceptsBeingPhotographed: true });
  });

  it('keeps the action clear of the keyboard, with the fields above it', async () => {
    const { within } = await import('@testing-library/react');
    renderJoin();

    const scroll = screen.getByTestId('scrollview');
    expect(within(scroll).getByPlaceholderText('Team name')).toBeTruthy();
    // The pinned action (blocked here, so labelled with its reason) sits outside
    // the scroll area so the keyboard never covers it.
    expect(within(scroll).queryByRole('button', { name: 'Enter the 6-character code' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Enter the 6-character code' })).toBeTruthy();
  });
});
