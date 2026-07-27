import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuessTargetView } from '@photochase/client';

const listGuessTargets = vi.fn();
const submitGuess = vi.fn();
vi.mock('../api.js', () => ({
  client: {
    listGuessTargets: (id: string) => listGuessTargets(id),
    submitGuess: (id: string, input: unknown) => submitGuess(id, input),
  },
}));

const { GuessScreen } = await import('./GuessScreen.js');

afterEach(() => {
  cleanup();
  [listGuessTargets, submitGuess].forEach((m) => m.mockReset());
});

function target(overrides: Partial<GuessTargetView> = {}): GuessTargetView {
  return { teamId: 't2', teamName: 'Blues', photoKeys: ['k1', 'k2'], myGuess: null, ...overrides };
}

/** An option button inside one axis row of one team's card. */
function option(axisLabel: string, value: string): HTMLElement {
  const row = screen.getByText(axisLabel).parentElement!;
  return within(row).getByRole('button', { name: value });
}

describe('GuessScreen', () => {
  it('lists each team to guess about, with how much there is to study', async () => {
    listGuessTargets.mockResolvedValue([target()]);
    render(<GuessScreen gameId="g1" />);

    expect(await screen.findByText('What was Blues hiding?')).toBeTruthy();
    expect(screen.getByText('2 photos to study')).toBeTruthy();
  });

  it('commits the picked elements for that team', async () => {
    listGuessTargets.mockResolvedValue([target()]);
    submitGuess.mockResolvedValue({ subjectTeamId: 't2', guess: {} });
    render(<GuessScreen gameId="g1" />);

    await screen.findByText('What was Blues hiding?');
    fireEvent.click(option('Colour', 'red'));
    fireEvent.click(option('Shape', 'round'));
    fireEvent.click(screen.getByRole('button', { name: 'Commit guess' }));

    await waitFor(() => expect(submitGuess).toHaveBeenCalled());
    expect(submitGuess.mock.calls[0]![1]).toEqual({
      subjectTeamId: 't2',
      guess: { color: 'red', shape: 'round' },
    });
  });

  it('shows the guess already committed, rather than a blank slate', async () => {
    listGuessTargets.mockResolvedValue([target({ myGuess: { color: 'green' } })]);
    submitGuess.mockResolvedValue({ subjectTeamId: 't2', guess: {} });
    render(<GuessScreen gameId="g1" />);

    await screen.findByText('What was Blues hiding?');
    fireEvent.click(screen.getByRole('button', { name: 'Commit guess' }));

    await waitFor(() => expect(submitGuess).toHaveBeenCalled());
    expect(submitGuess.mock.calls[0]![1].guess).toEqual({ color: 'green' });
  });

  it('lets a pick be cleared, since a blank answer is a legitimate one', async () => {
    listGuessTargets.mockResolvedValue([target({ myGuess: { color: 'green' } })]);
    submitGuess.mockResolvedValue({ subjectTeamId: 't2', guess: {} });
    render(<GuessScreen gameId="g1" />);

    await screen.findByText('What was Blues hiding?');
    fireEvent.click(option('Colour', 'green')); // tapping the chosen one clears it
    fireEvent.click(screen.getByRole('button', { name: 'Commit guess' }));

    await waitFor(() => expect(submitGuess).toHaveBeenCalled());
    expect(submitGuess.mock.calls[0]![1].guess).toEqual({});
  });

  it('replaces a pick within an axis rather than stacking', async () => {
    listGuessTargets.mockResolvedValue([target()]);
    submitGuess.mockResolvedValue({ subjectTeamId: 't2', guess: {} });
    render(<GuessScreen gameId="g1" />);

    await screen.findByText('What was Blues hiding?');
    fireEvent.click(option('Colour', 'red'));
    fireEvent.click(option('Colour', 'blue'));
    fireEvent.click(screen.getByRole('button', { name: 'Commit guess' }));

    await waitFor(() => expect(submitGuess).toHaveBeenCalled());
    expect(submitGuess.mock.calls[0]![1].guess).toEqual({ color: 'blue' });
  });

  it('confirms a saved guess', async () => {
    listGuessTargets.mockResolvedValue([target()]);
    submitGuess.mockResolvedValue({ subjectTeamId: 't2', guess: {} });
    render(<GuessScreen gameId="g1" />);

    await screen.findByText('What was Blues hiding?');
    fireEvent.click(screen.getByRole('button', { name: 'Commit guess' }));

    expect(await screen.findByText('Guess saved.')).toBeTruthy();
  });

  it('does not submit once the window is closed', async () => {
    listGuessTargets.mockResolvedValue([target()]);
    render(<GuessScreen gameId="g1" locked />);

    await screen.findByText('The guessing window is closed.');
    fireEvent.click(screen.getByRole('button', { name: 'Commit guess' }));

    await waitFor(() => expect(submitGuess).not.toHaveBeenCalled());
  });

  it('surfaces the server’s refusal', async () => {
    const { ApiError } = await import('@photochase/client');
    listGuessTargets.mockResolvedValue([target()]);
    submitGuess.mockRejectedValue(new ApiError(400, 'The guessing window is not open.'));
    render(<GuessScreen gameId="g1" />);

    await screen.findByText('What was Blues hiding?');
    fireEvent.click(screen.getByRole('button', { name: 'Commit guess' }));

    expect(await screen.findByText('The guessing window is not open.')).toBeTruthy();
  });

  it('reports a round that could not be loaded', async () => {
    listGuessTargets.mockRejectedValue(new Error('offline'));
    render(<GuessScreen gameId="g1" />);

    expect(await screen.findByText('Could not load the guessing round.')).toBeTruthy();
  });
});
