import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinalsView } from '@photochase/client';

const getFinals = vi.fn();
const castFinalsVote = vi.fn();
vi.mock('../api.js', () => ({
  client: {
    getFinals: (id: string) => getFinals(id),
    castFinalsVote: (id: string, input: unknown) => castFinalsVote(id, input),
  },
}));

const { FinalsScreen } = await import('./FinalsScreen.js');

afterEach(() => {
  cleanup();
  getFinals.mockReset();
  castFinalsVote.mockReset();
});

const BALLOT: FinalsView = {
  categories: [
    { id: 'best_overall_match', label: 'Best overall match' },
    { id: 'Craziest Pose', label: 'Craziest Pose' },
  ],
  teams: [
    { teamId: 't1', name: 'Reds' },
    { teamId: 't2', name: 'Blues' },
  ],
  myVotes: {},
};

/** A team button inside one category row. */
function teamIn(categoryLabel: string, name: string | RegExp): HTMLElement {
  const row = screen.getByText(categoryLabel).parentElement!;
  return within(row).getByRole('button', { name });
}

describe('FinalsScreen', () => {
  it('shows one row per category with the voting progress', async () => {
    getFinals.mockResolvedValue(BALLOT);
    render(<FinalsScreen gameId="g1" myTeamId="t1" />);

    expect(await screen.findByText('0 / 2 categories voted')).toBeTruthy();
    expect(screen.getByText('Best overall match')).toBeTruthy();
  });

  it('marks the player’s own team and does not vote for it', async () => {
    getFinals.mockResolvedValue(BALLOT);
    render(<FinalsScreen gameId="g1" myTeamId="t1" />);

    await screen.findByText('0 / 2 categories voted');
    // The server rejects self-votes, so the button must not even fire.
    fireEvent.click(teamIn('Best overall match', /Reds \(yours\)/));

    await waitFor(() => expect(castFinalsVote).not.toHaveBeenCalled());
  });

  it('casts a vote for another team in the named category', async () => {
    getFinals.mockResolvedValue(BALLOT);
    castFinalsVote.mockResolvedValue({ category: 'Craziest Pose', teamId: 't2' });
    render(<FinalsScreen gameId="g1" myTeamId="t1" />);

    await screen.findByText('0 / 2 categories voted');
    fireEvent.click(teamIn('Craziest Pose', 'Blues'));

    await waitFor(() => expect(castFinalsVote).toHaveBeenCalled());
    expect(castFinalsVote.mock.calls[0]![1]).toEqual({ category: 'Craziest Pose', teamId: 't2' });
  });

  it('counts the category as voted once the pick lands', async () => {
    getFinals.mockResolvedValue(BALLOT);
    castFinalsVote.mockResolvedValue({ category: 'Craziest Pose', teamId: 't2' });
    render(<FinalsScreen gameId="g1" myTeamId="t1" />);

    await screen.findByText('0 / 2 categories voted');
    fireEvent.click(teamIn('Craziest Pose', 'Blues'));

    expect(await screen.findByText('1 / 2 categories voted')).toBeTruthy();
  });

  it('reflects votes already cast', async () => {
    getFinals.mockResolvedValue({ ...BALLOT, myVotes: { best_overall_match: 't2' } });
    render(<FinalsScreen gameId="g1" myTeamId="t1" />);

    expect(await screen.findByText('1 / 2 categories voted')).toBeTruthy();
  });

  it('lets a judge with no team vote for anyone', async () => {
    getFinals.mockResolvedValue(BALLOT);
    castFinalsVote.mockResolvedValue({ category: 'best_overall_match', teamId: 't1' });
    render(<FinalsScreen gameId="g1" myTeamId={null} />);

    await screen.findByText('0 / 2 categories voted');
    fireEvent.click(teamIn('Best overall match', 'Reds'));

    await waitFor(() => expect(castFinalsVote).toHaveBeenCalled());
  });

  it('reports a ballot that could not be loaded', async () => {
    getFinals.mockRejectedValue(new Error('offline'));
    render(<FinalsScreen gameId="g1" myTeamId="t1" />);

    expect(await screen.findByText('Could not load the finals ballot.')).toBeTruthy();
  });
});
