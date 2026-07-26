import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamScore } from '@photochase/shared';

const getResults = vi.fn();
vi.mock('../api.js', () => ({ client: { getResults: (id: string) => getResults(id) } }));

const { ResultsScreen } = await import('./ResultsScreen.js');

afterEach(() => {
  cleanup();
  getResults.mockReset();
});

const TEAMS = [
  { teamId: 't1', name: 'Reds', memberCount: 2 },
  { teamId: 't2', name: 'Blues', memberCount: 3 },
];

function score(teamId: string, overrides: Partial<TeamScore> = {}): TeamScore {
  return {
    teamId,
    location: 0,
    pose: 0,
    angle: 0,
    timeBonus: 0,
    bestMatchBonus: 0,
    specialBonus: 0,
    foulPenalty: 0,
    total: 0,
    ...overrides,
  };
}

describe('ResultsScreen', () => {
  it('ranks teams by total regardless of payload order', async () => {
    getResults.mockResolvedValue({
      scoreboard: [score('t1', { total: 120 }), score('t2', { total: 360 })],
    });
    render(<ResultsScreen gameId="g1" teams={TEAMS} />);

    await screen.findByText('360');
    const rows = screen.getAllByText(/^\d+\. /).map((n) => n.textContent);
    expect(rows[0]).toBe('1. Blues');
    expect(rows[1]).toBe('2. Reds');
  });

  it('resolves team ids to names from the polled state', async () => {
    getResults.mockResolvedValue({ scoreboard: [score('t1', { total: 10 })] });
    render(<ResultsScreen gameId="g1" teams={TEAMS} />);

    expect(await screen.findByText('1. Reds')).toBeTruthy();
  });

  it('falls back to the id when a team is unknown', async () => {
    getResults.mockResolvedValue({ scoreboard: [score('ghost', { total: 10 })] });
    render(<ResultsScreen gameId="g1" teams={TEAMS} />);

    expect(await screen.findByText('1. ghost')).toBeTruthy();
  });

  it('shows only the score components that scored', async () => {
    getResults.mockResolvedValue({
      scoreboard: [score('t1', { location: 500, foulPenalty: 25, total: 475 })],
    });
    render(<ResultsScreen gameId="g1" teams={TEAMS} />);

    await screen.findByText('1. Reds');
    expect(screen.getByText('Location')).toBeTruthy();
    expect(screen.getByText('Fouls')).toBeTruthy();
    // Zeroed components stay hidden so a free game is not a wall of noughts.
    expect(screen.queryByText('Best match')).toBeNull();
    expect(screen.queryByText('Return bonus')).toBeNull();
  });

  it('reports results that could not be loaded', async () => {
    getResults.mockRejectedValue(new Error('offline'));
    render(<ResultsScreen gameId="g1" teams={TEAMS} />);

    expect(await screen.findByText('Could not load the results.')).toBeTruthy();
  });
});
