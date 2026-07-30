import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const joinGame = vi.fn();
const spectate = vi.fn();
vi.mock('../api.js', () => ({
  client: { joinGame: (input: unknown) => joinGame(input), spectate: (code: string) => spectate(code) },
}));

const { JoinScreen } = await import('./JoinScreen.js');
const { BarcodeScanContext, ViewfinderContext } = await import('../viewfinder.js');

afterEach(() => {
  cleanup();
  [joinGame, spectate].forEach((m) => m.mockReset());
});

type Team = { teamId: string; name: string; memberCount: number };

/** Point the code lookup at a game with a given roster and mode. */
const resolveWith = (teams: Team[], mode = 'photo_chase') =>
  spectate.mockResolvedValue({ game: { teams, config: { mode } } });

function renderJoin(props: Record<string, unknown> = {}) {
  return render(<JoinScreen displayName="Ada" onJoined={vi.fn()} {...props} />);
}

/** Resolve a code and land on the team-choice step. */
async function toTeamStep(teams: Team[] = [], mode = 'photo_chase') {
  resolveWith(teams, mode);
  fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: 'abc123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find game' }));
  await screen.findByText('Start your own team, or join one already in the game.');
}

describe('JoinScreen — code step', () => {
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

  it('names the missing code instead of resolving silently', () => {
    renderJoin();
    expect(screen.getByRole('button', { name: 'Enter the 6-character code' })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: 'ABC12' } });
    expect(screen.getByRole('button', { name: 'Enter the 6-character code' })).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: 'ABC123' } });
    expect(screen.getByRole('button', { name: 'Find game' })).toBeTruthy();
  });

  it('reports a code that resolves to no game', async () => {
    spectate.mockRejectedValue(new Error('404'));
    renderJoin();
    fireEvent.change(screen.getByPlaceholderText('ABC123'), { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find game' }));

    expect(await screen.findByText('No game with that code.')).toBeTruthy();
    expect(joinGame).not.toHaveBeenCalled();
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

describe('JoinScreen — team step', () => {
  it('starts a new team with the profile display name', async () => {
    joinGame.mockResolvedValue({ gameId: 'g1', teamId: 't1', role: 'captain' });
    const onJoined = vi.fn();
    renderJoin({ onJoined });
    await toTeamStep([]);

    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Reds' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start a team' }));

    await waitFor(() => expect(joinGame).toHaveBeenCalled());
    expect(joinGame.mock.calls[0]![0]).toEqual({
      code: 'ABC123',
      displayName: 'Ada',
      action: { type: 'create_team', name: 'Reds' },
    });
    expect(onJoined).toHaveBeenCalledWith({ gameId: 'g1', code: 'ABC123', teamId: 't1', role: 'captain' });
  });

  it('names the missing team name instead of starting silently', async () => {
    renderJoin();
    await toTeamStep([]);
    expect(screen.getByRole('button', { name: 'Name your team' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Name your team' }));
    expect(joinGame).not.toHaveBeenCalled();
  });

  it('joins an existing team from the roster, pluralising the count', async () => {
    joinGame.mockResolvedValue({ gameId: 'g1', teamId: 't1', role: 'member' });
    renderJoin();
    await toTeamStep([
      { teamId: 't1', name: 'Reds', memberCount: 3 },
      { teamId: 't2', name: 'Blues', memberCount: 1 },
    ]);

    // Counts follow the catalogue's plural forms, never `member(s)` in code.
    expect(screen.getByRole('button', { name: 'Reds · 3 members' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Blues · 1 member' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reds · 3 members' }));
    await waitFor(() => expect(joinGame).toHaveBeenCalled());
    expect(joinGame.mock.calls[0]![0]).toEqual({
      code: 'ABC123',
      displayName: 'Ada',
      action: { type: 'join_team', teamId: 't1' },
    });
  });

  it('offers no roster to join when the game is empty', async () => {
    renderJoin();
    await toTeamStep([]);
    expect(screen.queryByText('Join a team')).toBeNull();
  });

  it('goes back to the code step', async () => {
    renderJoin();
    await toTeamStep([{ teamId: 't1', name: 'Reds', memberCount: 2 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByPlaceholderText('ABC123')).toBeTruthy();
  });

  it('surfaces the server’s message when a join is refused', async () => {
    const { ApiError } = await import('@photochase/client');
    joinGame.mockRejectedValue(new ApiError(400, 'This game is full.'));
    renderJoin();
    await toTeamStep([]);

    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Reds' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start a team' }));
    expect(await screen.findByText('This game is full.')).toBeTruthy();
  });
});

describe('JoinScreen — deep link', () => {
  it('auto-resolves a code delivered as initialCode', async () => {
    resolveWith([{ teamId: 't1', name: 'Reds', memberCount: 2 }]);
    render(<JoinScreen displayName="Ada" initialCode="ABC234" onJoined={vi.fn()} />);

    await waitFor(() => expect(spectate).toHaveBeenCalledWith('ABC234'));
    await screen.findByText('Start your own team, or join one already in the game.');
  });

  it('waits for a full code before resolving', () => {
    render(<JoinScreen displayName="Ada" initialCode="ABC" onJoined={vi.fn()} />);
    expect(spectate).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('ABC123')).toBeTruthy();
  });
});

describe('JoinScreen — scanning', () => {
  /** Render inside a controllable camera so a scan can be fired into it. */
  function renderWithCamera() {
    let fire: ((data: string) => void) | null = null;
    const subscribe = (handler: (data: string) => void) => {
      fire = handler;
      return () => {
        fire = null;
      };
    };
    render(
      <ViewfinderContext.Provider value={() => {}}>
        <BarcodeScanContext.Provider value={subscribe}>
          <JoinScreen displayName="Ada" onJoined={vi.fn()} />
        </BarcodeScanContext.Provider>
      </ViewfinderContext.Provider>,
    );
    return { fire: (data: string) => act(() => fire!(data)) };
  }

  it('resolves a scanned code the same as typing it', async () => {
    resolveWith([]);
    const scanner = renderWithCamera();
    fireEvent.click(screen.getByRole('button', { name: 'Scan the host’s code' }));
    expect(screen.getByTestId('join-scanner')).toBeTruthy();

    scanner.fire('https://photochase.app/j/ABC234');

    await waitFor(() => expect(spectate).toHaveBeenCalledWith('ABC234'));
    await screen.findByText('Start your own team, or join one already in the game.');
  });

  it('ignores a scan that is not a join code, staying on the scanner', () => {
    const scanner = renderWithCamera();
    fireEvent.click(screen.getByRole('button', { name: 'Scan the host’s code' }));

    scanner.fire('just some text');

    expect(spectate).not.toHaveBeenCalled();
    expect(screen.getByTestId('join-scanner')).toBeTruthy();
  });
});

describe('JoinScreen — tag consent', () => {
  it('requires the photography acknowledgement before either path in a tag game', async () => {
    renderJoin();
    await toTeamStep([{ teamId: 't1', name: 'Reds', memberCount: 2 }], 'photo_tag');

    expect(screen.getByText('Other players will photograph you during this game.')).toBeTruthy();
    // Both the roster chip and the start action are blocked until agreement.
    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Blues' } });
    expect(screen.getByRole('button', { name: 'Agree to be photographed' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reds · 2 members' }));
    expect(joinGame).not.toHaveBeenCalled();
  });

  it('sends the acknowledgement once given', async () => {
    joinGame.mockResolvedValue({ gameId: 'g1', teamId: 't1', role: 'captain' });
    renderJoin();
    await toTeamStep([], 'photo_tag');

    fireEvent.click(screen.getByRole('button', { name: 'I agree' }));
    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Blues' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start a team' }));

    await waitFor(() => expect(joinGame).toHaveBeenCalled());
    expect(joinGame.mock.calls[0]![0]).toMatchObject({ acceptsBeingPhotographed: true });
  });
});
