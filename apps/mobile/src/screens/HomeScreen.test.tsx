import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeScreen } from './HomeScreen.js';

/**
 * Joining used to *be* the home screen: three text fields and five buttons, so
 * the two things almost everyone opens the app to do were buried in a form most
 * of them did not want yet.
 */

afterEach(cleanup);

describe('HomeScreen', () => {
  it('leads with the two choices, and nothing competing', () => {
    render(<HomeScreen onHost={vi.fn()} onJoin={vi.fn()} />);

    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Host a game', 'Join a game']);
  });

  it('routes to hosting and joining', () => {
    const onHost = vi.fn();
    const onJoin = vi.fn();
    render(<HomeScreen onHost={onHost} onJoin={onJoin} />);

    fireEvent.click(screen.getByRole('button', { name: 'Host a game' }));
    expect(onHost).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Join a game' }));
    expect(onJoin).toHaveBeenCalled();
  });

  it('keeps the solo and social surfaces reachable but quiet', () => {
    // They matter to people who already play, and to nobody opening the app
    // for the first time — so they are present, below, and never first.
    const onDailyHunt = vi.fn();
    render(
      <HomeScreen onHost={vi.fn()} onJoin={vi.fn()} onDailyHunt={onDailyHunt} onLeagues={vi.fn()} onInvite={vi.fn()} />,
    );

    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons.slice(0, 2)).toEqual(['Host a game', 'Join a game']);
    expect(buttons).toHaveLength(5);

    fireEvent.click(screen.getByRole('button', { name: 'Daily hunt' }));
    expect(onDailyHunt).toHaveBeenCalled();
  });

  it('says what the app is', () => {
    render(<HomeScreen onHost={vi.fn()} onJoin={vi.fn()} />);
    expect(screen.getByText('PhotoChase')).toBeTruthy();
  });
});
