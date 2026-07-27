import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DailyHuntView } from '@photochase/client';

const startDailyHunt = vi.fn();
vi.mock('../api.js', () => ({ client: { startDailyHunt: () => startDailyHunt() } }));

const { DailyHuntScreen } = await import('./DailyHuntScreen.js');

afterEach(() => {
  cleanup();
  startDailyHunt.mockReset();
});

const run = (overrides: Partial<DailyHuntView> = {}): DailyHuntView => ({
  gameId: 'g1',
  dateKey: '2026-07-27',
  theme: 'city',
  items: [
    { id: 'street_sign', label: 'A street sign', rarity: 'common' },
    { id: 'mural', label: 'A mural or street art', rarity: 'rare' },
  ],
  resumed: false,
  ...overrides,
});

describe('DailyHuntScreen', () => {
  it('says the list is shared, which is what makes a score comparable', () => {
    render(<DailyHuntScreen />);
    expect(screen.getByText('Same list for everyone, everywhere, today only.')).toBeTruthy();
  });

  it('starts today’s run and shows the list', async () => {
    startDailyHunt.mockResolvedValue(run());
    render(<DailyHuntScreen />);

    fireEvent.click(screen.getByRole('button', { name: "Play today's hunt" }));

    await waitFor(() => expect(startDailyHunt).toHaveBeenCalled());
    expect(await screen.findByText('A street sign')).toBeTruthy();
    expect(screen.getByText('Today: city')).toBeTruthy();
  });

  it('hands the game up so the app can route into it', async () => {
    startDailyHunt.mockResolvedValue(run());
    const onPlaying = vi.fn();
    render(<DailyHuntScreen onPlaying={onPlaying} />);

    fireEvent.click(screen.getByRole('button', { name: "Play today's hunt" }));
    await waitFor(() => expect(onPlaying).toHaveBeenCalledWith('g1'));
  });

  it('says it is resuming when a run is already in progress', async () => {
    startDailyHunt.mockResolvedValue(run({ resumed: true }));
    render(<DailyHuntScreen />);

    fireEvent.click(screen.getByRole('button', { name: "Play today's hunt" }));
    expect(await screen.findByRole('button', { name: "Back to today's hunt" })).toBeTruthy();
  });

  it('reports a run that could not be started', async () => {
    startDailyHunt.mockRejectedValue(new Error('offline'));
    render(<DailyHuntScreen />);

    fireEvent.click(screen.getByRole('button', { name: "Play today's hunt" }));
    expect(await screen.findByText("Could not start today's hunt.")).toBeTruthy();
  });

  it('ignores a second tap while one start is in flight', async () => {
    startDailyHunt.mockImplementation(() => new Promise(() => {}));
    render(<DailyHuntScreen />);

    const button = screen.getByRole('button', { name: "Play today's hunt" });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(startDailyHunt).toHaveBeenCalledTimes(1));
  });
});
