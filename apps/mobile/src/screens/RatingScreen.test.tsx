import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RateableView } from '@photochase/client';

const listRateable = vi.fn();
const castVote = vi.fn();
const flagFoul = vi.fn();
const clearFoul = vi.fn();
vi.mock('../api.js', () => ({
  client: {
    listRateable: (id: string) => listRateable(id),
    castVote: (id: string, input: unknown) => castVote(id, input),
    flagFoul: (id: string, photoId: string, input: unknown) => flagFoul(id, photoId, input),
    clearFoul: (id: string, photoId: string, input: unknown) => clearFoul(id, photoId, input),
  },
}));

const { RatingScreen } = await import('./RatingScreen.js');

afterEach(() => {
  cleanup();
  [listRateable, castVote, flagFoul, clearFoul].forEach((m) => m.mockReset());
});

function rateable(overrides: Partial<RateableView> = {}): RateableView {
  return {
    assignmentId: 'a1',
    originalPhotoId: 'p1',
    originalPhotoKey: 'k1',
    chasePhotoId: 'c1',
    chasePhotoKey: 'k2',
    myVotes: { pose: null, angle: null, validity: null },
    originalFouls: [],
    ...overrides,
  };
}

/** A star button inside one axis row. */
function star(axisLabel: string, value: string): HTMLElement {
  const row = screen.getByText(axisLabel).parentElement!;
  return within(row).getByRole('button', { name: value });
}

describe('RatingScreen', () => {
  it('counts an item as rated only when both axes are scored', async () => {
    listRateable.mockResolvedValue([
      rateable({ assignmentId: 'a1', myVotes: { pose: 4, angle: 4, validity: null } }),
      rateable({ assignmentId: 'a2', myVotes: { pose: 4, angle: null, validity: null } }),
    ]);
    render(<RatingScreen gameId="g1" />);

    // a2 has only one axis, so it is still outstanding.
    expect(await screen.findByText('1 / 2 rated')).toBeTruthy();
  });

  it('casts a vote on the named axis', async () => {
    listRateable.mockResolvedValue([rateable()]);
    castVote.mockResolvedValue({ voteId: 'v1' });
    render(<RatingScreen gameId="g1" />);

    await screen.findByText('0 / 1 rated');
    fireEvent.click(star('Angle match', '3'));

    await waitFor(() => expect(castVote).toHaveBeenCalled());
    expect(castVote.mock.calls[0]![1]).toEqual({ assignmentId: 'a1', axis: 'angle', stars: 3 });
  });

  it('advances only once both axes are in', async () => {
    listRateable.mockResolvedValue([rateable({ myVotes: { pose: 5, angle: null, validity: null } })]);
    castVote.mockResolvedValue({ voteId: 'v1' });
    render(<RatingScreen gameId="g1" />);

    await screen.findByText('0 / 1 rated');
    fireEvent.click(star('Angle match', '4'));

    expect(await screen.findByText('All rated — waiting for the host.')).toBeTruthy();
  });

  it('flags a foul on the original being compared', async () => {
    listRateable.mockResolvedValue([rateable()]);
    flagFoul.mockResolvedValue({ fouls: ['missing_face'] });
    render(<RatingScreen gameId="g1" />);

    await screen.findByText('0 / 1 rated');
    fireEvent.click(screen.getByRole('button', { name: 'No face' }));

    await waitFor(() => expect(flagFoul).toHaveBeenCalled());
    expect(flagFoul.mock.calls[0]![1]).toBe('p1');
    expect(flagFoul.mock.calls[0]![2]).toEqual({ reason: 'missing_face' });
  });

  it('clears a foul that is already called', async () => {
    listRateable.mockResolvedValue([rateable({ originalFouls: ['missing_clue'] })]);
    clearFoul.mockResolvedValue({ fouls: [] });
    render(<RatingScreen gameId="g1" />);

    await screen.findByText('0 / 1 rated');
    fireEvent.click(screen.getByRole('button', { name: 'No location clue' }));

    await waitFor(() => expect(clearFoul).toHaveBeenCalled());
    expect(flagFoul).not.toHaveBeenCalled();
  });

  it('reports a failed vote without changing the tally', async () => {
    listRateable.mockResolvedValue([rateable()]);
    castVote.mockRejectedValue(new Error('offline'));
    render(<RatingScreen gameId="g1" />);

    await screen.findByText('0 / 1 rated');
    fireEvent.click(star('Pose match', '5'));

    expect(await screen.findByText('Could not save that rating.')).toBeTruthy();
    expect(screen.getByText('0 / 1 rated')).toBeTruthy();
  });

  it('reports a list that could not be loaded', async () => {
    listRateable.mockRejectedValue(new Error('offline'));
    render(<RatingScreen gameId="g1" />);

    expect(await screen.findByText('Could not load photos to rate.')).toBeTruthy();
  });
});

/** A scavenger claim has no original to compare, so it is judged differently. */
const claim = (overrides: Partial<RateableView> = {}): RateableView =>
  rateable({ itemId: 'leaf', itemLabel: 'A leaf bigger than your hand', ...overrides });

describe('RatingScreen — scavenger hunt', () => {
  it('names the item the photo claims', async () => {
    listRateable.mockResolvedValue([claim()]);
    render(<RatingScreen gameId="g1" />);

    expect(await screen.findByText('Claimed: A leaf bigger than your hand')).toBeTruthy();
  });

  it('asks only about validity, not pose or angle', async () => {
    listRateable.mockResolvedValue([claim()]);
    render(<RatingScreen gameId="g1" />);

    await screen.findByText('Does it count?');
    expect(screen.queryByText('Pose match')).toBeNull();
    expect(screen.queryByText('Angle match')).toBeNull();
  });

  it('casts the vote on the validity axis', async () => {
    listRateable.mockResolvedValue([claim()]);
    castVote.mockResolvedValue({ voteId: 'v1' });
    render(<RatingScreen gameId="g1" />);

    await screen.findByText('0 / 1 rated');
    fireEvent.click(star('Does it count?', '5'));

    await waitFor(() => expect(castVote).toHaveBeenCalled());
    expect(castVote.mock.calls[0]![1]).toEqual({ assignmentId: 'a1', axis: 'validity', stars: 5 });
  });

  it('finishes a claim on that one axis alone', async () => {
    listRateable.mockResolvedValue([claim()]);
    castVote.mockResolvedValue({ voteId: 'v1' });
    render(<RatingScreen gameId="g1" />);

    await screen.findByText('0 / 1 rated');
    fireEvent.click(star('Does it count?', '4'));

    expect(await screen.findByText('All rated — waiting for the host.')).toBeTruthy();
  });

  it('offers the missing-item foul in place of the clue foul', async () => {
    listRateable.mockResolvedValue([claim()]);
    flagFoul.mockResolvedValue({ fouls: ['missing_item'] });
    render(<RatingScreen gameId="g1" />);

    await screen.findByText('0 / 1 rated');
    expect(screen.queryByRole('button', { name: 'No location clue' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "Item isn't there" }));

    await waitFor(() => expect(flagFoul).toHaveBeenCalled());
    expect(flagFoul.mock.calls[0]![2]).toEqual({ reason: 'missing_item' });
  });
});
