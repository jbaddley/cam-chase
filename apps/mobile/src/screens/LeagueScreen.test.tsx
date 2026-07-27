import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntitlementView, StandingsView } from '@photochase/client';

const getStandings = vi.fn();
const createTournament = vi.fn();
vi.mock('../api.js', () => ({
  client: {
    getStandings: (code: string) => getStandings(code),
    createTournament: (name: string) => createTournament(name),
  },
}));

const { LeagueScreen } = await import('./LeagueScreen.js');

afterEach(() => {
  cleanup();
  [getStandings, createTournament].forEach((m) => m.mockReset());
});

function standings(overrides: Partial<StandingsView> = {}): StandingsView {
  return {
    tournamentId: 'tourney_1',
    code: 'LEAG01',
    name: 'Summer League',
    gamesPlayed: 2,
    standings: [
      { teamKey: 'reds', teamName: 'Reds', gamesPlayed: 2, wins: 2, placementPoints: 20, totalGamePoints: 380 },
      { teamKey: 'blues', teamName: 'Blues', gamesPlayed: 2, wins: 0, placementPoints: 12, totalGamePoints: 250 },
    ],
    ...overrides,
  };
}

const entitlement = (createLeagues: boolean): EntitlementView =>
  ({ features: { create_leagues: createLeagues } }) as unknown as EntitlementView;

const input = (placeholder: string) => screen.getByPlaceholderText(placeholder);
const button = (label: string) => screen.getByRole('button', { name: label });

describe('LeagueScreen — looking up a league', () => {
  it('shows the table for a looked-up code', async () => {
    getStandings.mockResolvedValue(standings());
    render(<LeagueScreen />);

    fireEvent.change(input('League code'), { target: { value: 'leag01' } });
    fireEvent.click(button('Look up a league'));

    await waitFor(() => expect(getStandings).toHaveBeenCalledWith('LEAG01'));
    expect(await screen.findByText('Summer League')).toBeTruthy();
    expect(screen.getByText('2 games played')).toBeTruthy();
  });

  it('ranks teams by placement points, highest first', async () => {
    getStandings.mockResolvedValue(standings());
    render(<LeagueScreen />);

    fireEvent.change(input('League code'), { target: { value: 'LEAG01' } });
    fireEvent.click(button('Look up a league'));

    await screen.findByText('Summer League');
    const rows = screen.getAllByText(/^\d+\. /).map((n) => n.textContent);
    expect(rows).toEqual(['1. Reds', '2. Blues']);
  });

  it('shows a season nobody has played yet as empty, not as an error', async () => {
    getStandings.mockResolvedValue(standings({ gamesPlayed: 0, standings: [] }));
    render(<LeagueScreen />);

    fireEvent.change(input('League code'), { target: { value: 'LEAG01' } });
    fireEvent.click(button('Look up a league'));

    expect(await screen.findByText('No games played yet. Host one with this code.')).toBeTruthy();
  });

  it('does not call the server for an empty code', async () => {
    render(<LeagueScreen />);
    fireEvent.click(button('Look up a league'));
    await waitFor(() => expect(getStandings).not.toHaveBeenCalled());
  });

  it('reports a league that could not be loaded', async () => {
    getStandings.mockRejectedValue(new Error('offline'));
    render(<LeagueScreen />);

    fireEvent.change(input('League code'), { target: { value: 'NOPE01' } });
    fireEvent.click(button('Look up a league'));

    expect(await screen.findByText('Could not load the league.')).toBeTruthy();
  });
});

describe('LeagueScreen — creating a league', () => {
  it('creates a league and shows its fresh table', async () => {
    createTournament.mockResolvedValue({ tournamentId: 't1', code: 'NEWLGE' });
    getStandings.mockResolvedValue(standings({ code: 'NEWLGE', name: 'Autumn', gamesPlayed: 0, standings: [] }));
    render(<LeagueScreen entitlement={entitlement(true)} />);

    fireEvent.change(input('League name'), { target: { value: 'Autumn' } });
    fireEvent.click(button('Start a league'));

    await waitFor(() => expect(createTournament).toHaveBeenCalledWith('Autumn'));
    expect(await screen.findByText('League code: NEWLGE')).toBeTruthy();
  });

  it('does not create a league with a blank name', async () => {
    render(<LeagueScreen entitlement={entitlement(true)} />);
    fireEvent.change(input('League name'), { target: { value: '   ' } });
    fireEvent.click(button('Start a league'));
    await waitFor(() => expect(createTournament).not.toHaveBeenCalled());
  });

  it('says why a free user cannot start one, rather than hiding the control', async () => {
    render(<LeagueScreen entitlement={entitlement(false)} />);
    expect(screen.getByText('Starting a league needs a paid plan. Joining one is free.')).toBeTruthy();
    // Looking one up stays available: playing in someone else's league is free.
    expect(button('Look up a league')).toBeTruthy();
  });

  it('surfaces the server’s refusal if the client-side gate is stale', async () => {
    const { ApiError } = await import('@photochase/client');
    createTournament.mockRejectedValue(new ApiError(400, 'Starting a league needs a paid plan.'));
    render(<LeagueScreen entitlement={entitlement(true)} />);

    fireEvent.change(input('League name'), { target: { value: 'Autumn' } });
    fireEvent.click(button('Start a league'));

    expect(await screen.findByText('Starting a league needs a paid plan.')).toBeTruthy();
  });
});
