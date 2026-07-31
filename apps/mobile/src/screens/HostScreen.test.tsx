import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntitlementView } from '@photochase/client';

const getEntitlement = vi.fn();
const createGame = vi.fn();

vi.mock('../api.js', () => ({
  client: {
    getEntitlement: () => getEntitlement(),
    createGame: (config: unknown, options: unknown) => createGame(config, options),
  },
}));

const { HostScreen } = await import('./HostScreen.js');

afterEach(() => {
  cleanup();
  getEntitlement.mockReset();
  createGame.mockReset();
});

/** An entitlement view with the given limits; unlisted fields are harmless. */
function entitlement(
  overrides: Partial<EntitlementView['limits']>,
  tier = 'free',
  modes: EntitlementView['modes'] = ['photo_chase'],
): EntitlementView {
  return {
    tier,
    gameCredits: 0,
    subscriptionActive: false,
    canStartGame: true,
    modes,
    limits: {
      maxTeams: 2,
      allowedGameTypes: ['round_robin'],
      maxJudgeWeight: 1,
      allowSpecialCategories: false,
      allowGeofencing: false,
      allowAiJudging: false,
      configurableRounds: false,
      gamesGranted: 'unlimited',
      ...overrides,
    },
    features: {},
  } as unknown as EntitlementView;
}

/**
 * Name the host's team, which every playing host must do before the game can
 * be created. Most tests are about settings rather than the host, so they call
 * this to get past the gate.
 */
function nameTeam(name = 'Reds') {
  fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: name } });
}

/** A top-level action button (Create game, Back). */
const action = (label: string) => screen.getByRole('button', { name: label });

/**
 * An option within one settings row. Values repeat across rows — 20 is both a
 * photo count and a minute count — so every lookup must name its field.
 */
function option(fieldLabel: string, value: string): HTMLElement {
  const field = screen.getByText(fieldLabel).parentElement!;
  return within(field).getByRole('button', { name: value });
}

describe('HostScreen', () => {
  it('shows the caller’s tier once the entitlement loads', async () => {
    getEntitlement.mockResolvedValue(entitlement({}, 'game_pack'));
    render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByText(/game_pack/)).toBeTruthy();
  });

  it('creates a game with the default config', async () => {
    getEntitlement.mockResolvedValue(entitlement({}));
    createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
    const onHosting = vi.fn();
    render(<HostScreen onHosting={onHosting} onCancel={vi.fn()} />);

    await screen.findByText(/free/);
    nameTeam();
    fireEvent.click(action('Create game'));

    await waitFor(() => expect(onHosting).toHaveBeenCalled());
    // The host joins their own game: hosting is not spectating by default.
    expect(onHosting.mock.calls[0]![0]).toMatchObject({ gameId: 'g1', code: 'ABC123', teamId: 't1', role: 'host' });
    expect(createGame.mock.calls[0]![1]).toEqual({ host: { type: 'create_team', name: 'Reds' } });
  });

  it('ignores a team count the plan does not allow', async () => {
    getEntitlement.mockResolvedValue(entitlement({ maxTeams: 2 }));
    createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
    render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

    await screen.findByText(/free/);
    fireEvent.click(option('Teams', '6')); // beyond the free cap
    nameTeam();
    fireEvent.click(action('Create game'));

    await waitFor(() => expect(createGame).toHaveBeenCalled());
    expect(createGame.mock.calls[0]![0]).toMatchObject({ maxTeams: 2 });
  });

  it('applies a team count the plan does allow', async () => {
    getEntitlement.mockResolvedValue(entitlement({ maxTeams: 6 }, 'game_pack'));
    createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
    render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

    await screen.findByText(/game_pack/);
    fireEvent.click(option('Teams', '6'));
    nameTeam();
    fireEvent.click(action('Create game'));

    await waitFor(() => expect(createGame).toHaveBeenCalled());
    expect(createGame.mock.calls[0]![0]).toMatchObject({ maxTeams: 6 });
  });

  it('ignores round settings when the plan locks them', async () => {
    getEntitlement.mockResolvedValue(entitlement({ configurableRounds: false }));
    createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
    render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

    await screen.findByText(/free/);
    fireEvent.click(option('Photos per round', '20')); // locked on free
    nameTeam();
    fireEvent.click(action('Create game'));

    await waitFor(() => expect(createGame).toHaveBeenCalled());
    expect(createGame.mock.calls[0]![0]).toMatchObject({ photosPerRound: 5 });
  });

  it('ignores a game type outside the plan', async () => {
    getEntitlement.mockResolvedValue(entitlement({ allowedGameTypes: ['round_robin'] }));
    createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
    render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

    await screen.findByText(/free/);
    fireEvent.click(option('Game type', 'decoy'));
    nameTeam();
    fireEvent.click(action('Create game'));

    await waitFor(() => expect(createGame).toHaveBeenCalled());
    expect(createGame.mock.calls[0]![0]).toMatchObject({ gameType: 'round_robin' });
  });

  it('clamps a config that starts above the plan cap', async () => {
    // The default config allows more teams than a hypothetical 2-team plan.
    getEntitlement.mockResolvedValue(entitlement({ maxTeams: 2 }));
    createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
    render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

    await screen.findByText(/free/);
    nameTeam();
    fireEvent.click(action('Create game'));

    await waitFor(() => expect(createGame).toHaveBeenCalled());
    expect(createGame.mock.calls[0]![0].maxTeams).toBeLessThanOrEqual(2);
  });

  it('surfaces the server’s rejection message', async () => {
    getEntitlement.mockResolvedValue(entitlement({}));
    const { ApiError } = await import('@photochase/client');
    createGame.mockRejectedValue(new ApiError(400, 'Free tier allows at most 2 teams.'));
    render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

    await screen.findByText(/free/);
    nameTeam();
    fireEvent.click(action('Create game'));

    expect(await screen.findByText('Free tier allows at most 2 teams.')).toBeTruthy();
  });

  it('still renders when the entitlement cannot be loaded', async () => {
    getEntitlement.mockRejectedValue(new Error('offline'));
    render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByText('Could not load your plan.')).toBeTruthy();
    // Creating must stay possible; the server is the real gate. Once the host
    // names their team the action is live rather than stating what it needs.
    nameTeam();
    expect(action('Create game')).toBeTruthy();
  });

  describe('game mode', () => {
    it('defaults to the photo chase', async () => {
      getEntitlement.mockResolvedValue(entitlement({}));
      createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/free/);
      nameTeam();
    fireEvent.click(action('Create game'));

      await waitFor(() => expect(createGame).toHaveBeenCalled());
      expect(createGame.mock.calls[0]![0]).toMatchObject({ mode: 'photo_chase' });
    });

    it('ignores a mode the entitlement does not include', async () => {
      getEntitlement.mockResolvedValue(entitlement({}, 'free', ['photo_chase']));
      createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/free/);
      fireEvent.click(option('Game', 'Scavenger hunt'));
      nameTeam();
    fireEvent.click(action('Create game'));

      await waitFor(() => expect(createGame).toHaveBeenCalled());
      expect(createGame.mock.calls[0]![0]).toMatchObject({ mode: 'photo_chase' });
    });

    it('applies a mode earned outside the tier', async () => {
      // Referral unlocks are additive, so a free user can hold a paid mode.
      getEntitlement.mockResolvedValue(entitlement({}, 'free', ['photo_chase', 'scavenger_hunt']));
      createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/free/);
      fireEvent.click(option('Game', 'Scavenger hunt'));
      nameTeam();
    fireEvent.click(action('Create game'));

      await waitFor(() => expect(createGame).toHaveBeenCalled());
      expect(createGame.mock.calls[0]![0]).toMatchObject({ mode: 'scavenger_hunt' });
    });

    it('hides the Round 2 assignment strategy outside the chase', async () => {
      getEntitlement.mockResolvedValue(entitlement({}, 'unlimited', ['photo_chase', 'scavenger_hunt']));
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/unlimited/);
      expect(screen.queryByText('Game type')).toBeTruthy();

      // Assignment strategy is a Round 2 concept and a hunt has no Round 2.
      fireEvent.click(option('Game', 'Scavenger hunt'));
      expect(screen.queryByText('Game type')).toBeNull();
    });

    it('offers the hunt theme only once a hunt is chosen', async () => {
      getEntitlement.mockResolvedValue(entitlement({}, 'unlimited', ['photo_chase', 'scavenger_hunt']));
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/unlimited/);
      expect(screen.queryByText('Hunt theme')).toBeNull();

      fireEvent.click(option('Game', 'Scavenger hunt'));
      expect(screen.queryByText('Hunt theme')).toBeTruthy();
    });

    it('offers the guess level only for a colour hunt', async () => {
      getEntitlement.mockResolvedValue(entitlement({}, 'unlimited', ['photo_chase', 'color_hunt']));
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/unlimited/);
      expect(screen.queryByText('Guess level')).toBeNull();

      fireEvent.click(option('Game', 'Colour hunt'));
      expect(screen.queryByText('Guess level')).toBeTruthy();
      // The hunt theme belongs to a different mode and must not appear.
      expect(screen.queryByText('Hunt theme')).toBeNull();
    });

    it('sends the chosen guess level', async () => {
      getEntitlement.mockResolvedValue(entitlement({}, 'unlimited', ['photo_chase', 'color_hunt']));
      createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/unlimited/);
      fireEvent.click(option('Game', 'Colour hunt'));
      fireEvent.click(option('Guess level', 'Colour + one more'));
      nameTeam();
    fireEvent.click(action('Create game'));

      await waitFor(() => expect(createGame).toHaveBeenCalled());
      expect(createGame.mock.calls[0]![0]).toMatchObject({ mode: 'color_hunt', colorSpecificity: 'color_plus' });
    });

    it('sends the chosen hunt theme', async () => {
      getEntitlement.mockResolvedValue(entitlement({}, 'unlimited', ['photo_chase', 'scavenger_hunt']));
      createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/unlimited/);
      fireEvent.click(option('Game', 'Scavenger hunt'));
      fireEvent.click(option('Hunt theme', 'City'));
      nameTeam();
    fireEvent.click(action('Create game'));

      await waitFor(() => expect(createGame).toHaveBeenCalled());
      expect(createGame.mock.calls[0]![0]).toMatchObject({ mode: 'scavenger_hunt', huntTheme: 'city' });
    });
  });

  describe('how the host takes part', () => {
    it('will not create a playing game until the team is named', async () => {
      // The whole bug this replaced: a host who was never asked ended up
      // watching a game they had organised, unable to shoot anything.
      getEntitlement.mockResolvedValue(entitlement({}));
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/free/);
      // Blocked, and the action says why rather than sitting greyed (docs/10).
      fireEvent.click(action('Name your team'));

      expect(createGame).not.toHaveBeenCalled();
    });

    it('rejects a name that is only spaces', async () => {
      getEntitlement.mockResolvedValue(entitlement({}));
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/free/);
      nameTeam('   ');
      fireEvent.click(action('Name your team'));

      expect(createGame).not.toHaveBeenCalled();
    });

    it('sends the trimmed team name', async () => {
      getEntitlement.mockResolvedValue(entitlement({}));
      createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/free/);
      nameTeam('  Reds  ');
      fireEvent.click(action('Create game'));

      await waitFor(() => expect(createGame).toHaveBeenCalled());
      expect(createGame.mock.calls[0]![1]).toEqual({ host: { type: 'create_team', name: 'Reds' } });
    });

    it('lets the host judge instead, with no team to name', async () => {
      getEntitlement.mockResolvedValue(entitlement({}));
      createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: null });
      const onHosting = vi.fn();
      render(<HostScreen onHosting={onHosting} onCancel={vi.fn()} />);

      await screen.findByText(/free/);
      fireEvent.click(option('You are', 'Judging'));
      // The name field is gone, and its absence must not block creation.
      expect(screen.queryByPlaceholderText('Team name')).toBeNull();
      fireEvent.click(action('Create game'));

      await waitFor(() => expect(createGame).toHaveBeenCalled());
      expect(createGame.mock.calls[0]![1]).toEqual({ host: { type: 'judge' } });
      // Still the host: judging does not cost them the start button.
      expect(onHosting.mock.calls[0]![0]).toMatchObject({ teamId: null, role: 'host' });
    });

    it('lets the host merely watch', async () => {
      getEntitlement.mockResolvedValue(entitlement({}));
      createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: null });
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/free/);
      fireEvent.click(option('You are', 'Watching'));
      fireEvent.click(action('Create game'));

      await waitFor(() => expect(createGame).toHaveBeenCalled());
      expect(createGame.mock.calls[0]![1]).toEqual({ host: { type: 'spectator' } });
    });

    it('asks for the team again when the host switches back to playing', async () => {
      getEntitlement.mockResolvedValue(entitlement({}));
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/free/);
      fireEvent.click(option('You are', 'Judging'));
      fireEvent.click(option('You are', 'Playing'));

      expect(screen.getByPlaceholderText('Team name')).toBeTruthy();
      fireEvent.click(action('Name your team'));
      expect(createGame).not.toHaveBeenCalled();
    });
  });

  describe('geofencing', () => {
    it('lets a paid host turn it on and sends it in the config', async () => {
      getEntitlement.mockResolvedValue(entitlement({ allowGeofencing: true }, 'game_pack'));
      createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/game_pack/);
      nameTeam();
      fireEvent.click(option('Geofencing', 'On'));
      fireEvent.click(action('Create game'));

      await waitFor(() => expect(createGame).toHaveBeenCalled());
      expect(createGame.mock.calls[0]![0]).toMatchObject({ geofencing: true });
    });

    it('greys out On for a plan without it, so it cannot be enabled', async () => {
      getEntitlement.mockResolvedValue(entitlement({}, 'free')); // allowGeofencing: false
      createGame.mockResolvedValue({ gameId: 'g1', code: 'ABC123', teamId: 't1' });
      render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);

      await screen.findByText(/free/);
      nameTeam();
      fireEvent.click(option('Geofencing', 'On')); // disabled — a no-op
      fireEvent.click(action('Create game'));

      await waitFor(() => expect(createGame).toHaveBeenCalled());
      expect(createGame.mock.calls[0]![0]).toMatchObject({ geofencing: false });
    });
  });

  it('keeps Create game clear of the keyboard, below the scrolling settings', async () => {
    // The team-name field puts a keyboard up, and every option plus the create
    // button sat behind it.
    getEntitlement.mockResolvedValue(entitlement({}));
    render(<HostScreen onHosting={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByText(/free/);
    nameTeam();

    const scroll = screen.getByTestId('scrollview');
    expect(within(scroll).getByPlaceholderText('Team name')).toBeTruthy();
    expect(within(scroll).queryByRole('button', { name: 'Create game' })).toBeNull();
    expect(action('Create game')).toBeTruthy();
    expect(scroll.getAttribute('data-persist-taps')).toBe('handled');
  });
});
