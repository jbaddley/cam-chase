import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Joining a game used to replace the whole app with it, with nothing to put it
 * back — a player who joined the wrong code had to force-quit. This bar is the
 * way out, so what matters is that it always offers one, and that it does the
 * right thing on each side of the start of play.
 */

const leaveGame = vi.fn();
const abandonGame = vi.fn();
vi.mock('../api.js', () => ({
  client: { leaveGame: (id: string) => leaveGame(id), abandonGame: (id: string) => abandonGame(id) },
}));

const { GameBar } = await import('./GameBar.js');

afterEach(() => {
  cleanup();
  [leaveGame, abandonGame].forEach((m) => m.mockReset());
});

function bar(props: Partial<Parameters<typeof GameBar>[0]> = {}) {
  const onExit = vi.fn();
  render(
    <GameBar gameId="g1" code="ABC123" isHost={false} inLobby={true} onExit={onExit} {...props} />,
  );
  return onExit;
}

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('GameBar', () => {
  it('shows the code and a way out', () => {
    bar();
    expect(screen.getByText('ABC123')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leave' })).toBeTruthy();
  });

  it('asks before leaving, and staying does nothing', () => {
    const onExit = bar();
    press('Leave');
    press('Stay');

    expect(leaveGame).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('really leaves a lobby, so the host is not left waiting', async () => {
    leaveGame.mockResolvedValue({ left: true });
    const onExit = bar({ inLobby: true });

    press('Leave');
    press('Leave');

    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(leaveGame).toHaveBeenCalledWith('g1');
  });

  it('only stops watching once play has started', async () => {
    // The membership stays: photos and votes are attached to it and still have
    // to count. Walking away mid-game is a local act.
    const onExit = bar({ inLobby: false });

    press('Leave');
    press('Leave');

    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(leaveGame).not.toHaveBeenCalled();
  });

  it('offers the host ending it for everyone', async () => {
    abandonGame.mockResolvedValue({ state: 'archived' });
    const onExit = bar({ isHost: true });

    press('Leave');
    expect(screen.getByText('End this game?')).toBeTruthy();
    press('End for everyone');

    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(abandonGame).toHaveBeenCalledWith('g1');
  });

  it('lets the host walk away without ending everyone else’s game', async () => {
    const onExit = bar({ isHost: true, inLobby: false });

    press('Leave');
    press('Just leave, keep the game running');

    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(abandonGame).not.toHaveBeenCalled();
  });

  it('keeps the player in the game when leaving fails', async () => {
    // Exiting anyway would show them a home screen while the server still has
    // them in a lobby that is now one player short of starting.
    const { ApiError } = await import('@photochase/client');
    leaveGame.mockRejectedValue(new ApiError(400, 'The game has already started.'));
    const onExit = bar({ inLobby: true });

    press('Leave');
    press('Leave');

    expect(await screen.findByText('The game has already started.')).toBeTruthy();
    expect(onExit).not.toHaveBeenCalled();
  });
});
