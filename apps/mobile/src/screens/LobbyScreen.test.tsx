import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameStateView } from '@photochase/client';

const startGame = vi.fn();
vi.mock('../api.js', () => ({ client: { startGame: (id: string) => startGame(id) } }));

const { LobbyScreen } = await import('./LobbyScreen.js');

afterEach(() => {
  cleanup();
  startGame.mockReset();
});

function game(
  teamCount: number,
  state: GameStateView['state'] = 'lobby',
  hostTier: GameStateView['hostTier'] = 'free',
): GameStateView {
  return {
    id: 'g1',
    code: 'ABC123',
    state,
    config: {} as GameStateView['config'],
    teams: Array.from({ length: teamCount }, (_, i) => ({
      teamId: `t${i}`,
      name: `Team ${i}`,
      memberCount: i + 1,
    })),
    playerCount: teamCount,
    hostTier,
  };
}

const startButton = () => screen.queryByRole('button', { name: 'Start game' });

const HOST_PERK = "Everyone here is playing on the host's unlimited plan.";

describe('LobbyScreen', () => {
  it('shows the code, phase, and roster', () => {
    render(<LobbyScreen game={game(2)} code="ABC123" />);

    expect(screen.getByText('Code')).toBeTruthy();
    expect(screen.getByText('ABC123')).toBeTruthy();
    expect(screen.getByText('Waiting for teams')).toBeTruthy();
    expect(screen.getByText('2 teams joined')).toBeTruthy();
    expect(screen.getByText('Team 0')).toBeTruthy();
  });

  it('shows a loading phase before the first poll lands', () => {
    render(<LobbyScreen game={null} code="ABC123" />);
    expect(screen.getByText('Connecting…')).toBeTruthy();
  });

  it('hides the start control from a non-host', () => {
    render(<LobbyScreen game={game(2)} code="ABC123" />);
    expect(startButton()).toBeNull();
  });

  it('withholds start from the host until two teams have joined', () => {
    render(<LobbyScreen game={game(1)} code="ABC123" isHost />);
    expect(startButton()).toBeNull();
  });

  it('offers start to the host once two teams have joined', () => {
    render(<LobbyScreen game={game(2)} code="ABC123" isHost />);
    expect(startButton()).toBeTruthy();
  });

  it('withholds start once the game has left the lobby', () => {
    render(<LobbyScreen game={game(2, 'round1_active')} code="ABC123" isHost />);
    expect(startButton()).toBeNull();
  });

  it('starts the game and reports the new state', async () => {
    startGame.mockResolvedValue({ state: 'round1_active' });
    const onStarted = vi.fn();
    render(<LobbyScreen game={game(2)} code="ABC123" isHost onStarted={onStarted} />);

    fireEvent.click(startButton()!);

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('round1_active'));
    expect(startGame).toHaveBeenCalledWith('g1');
  });

  it('surfaces the server’s refusal to start', async () => {
    const { ApiError } = await import('@photochase/client');
    startGame.mockRejectedValue(new ApiError(400, 'No game credits left.'));
    render(<LobbyScreen game={game(2)} code="ABC123" isHost />);

    fireEvent.click(startButton()!);

    expect(await screen.findByText('No game credits left.')).toBeTruthy();
  });

  it('shows a polling error passed down from the app root', () => {
    render(<LobbyScreen game={game(2)} code="ABC123" error="Reconnecting…" />);
    expect(screen.getByText('Reconnecting…')).toBeTruthy();
  });

  it('tells the lobby it is playing on the host’s plan', () => {
    // Only the host's tier gates a game — the clearest reason to invite people.
    render(<LobbyScreen game={game(2, 'lobby', 'unlimited')} code="ABC123" />);
    expect(screen.getByText(HOST_PERK)).toBeTruthy();
  });

  it('says nothing about a plan when the host is on the free tier', () => {
    render(<LobbyScreen game={game(2, 'lobby', 'free')} code="ABC123" />);
    expect(screen.queryByText(/playing on the host/)).toBeNull();
  });
});
