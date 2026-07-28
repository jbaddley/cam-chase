import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegroupView } from '@photochase/client';

const checkIn = vi.fn();
const advanceGame = vi.fn();
vi.mock('../api.js', () => ({
  client: {
    checkIn: (id: string, input: unknown) => checkIn(id, input),
    advanceGame: (id: string, event: string, opts?: unknown) => advanceGame(id, event, opts),
  },
}));

const { ReturnScreen } = await import('./ReturnScreen.js');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  checkIn.mockReset();
  advanceGame.mockReset();
  checkIn.mockResolvedValue({ round: 'round1', at: 1 });
  advanceGame.mockResolvedValue({ state: 'round2_active' });
});
checkIn.mockResolvedValue({ round: 'round1', at: 1 });
advanceGame.mockResolvedValue({ state: 'round2_active' });

const FIX = { lat: 40, lng: -74, accuracyM: 5 };

/** A location source that reports one fix on demand and never moves. */
const still = { current: () => Promise.resolve(FIX), watch: () => () => {} };

/** A source whose watch callback can be fired by the test, like a team walking. */
function walking() {
  const listeners: Array<(fix: typeof FIX) => void> = [];
  return {
    source: {
      current: () => Promise.resolve(FIX),
      watch: (onFix: (fix: typeof FIX) => void) => {
        listeners.push(onFix);
        return () => listeners.splice(listeners.indexOf(onFix), 1);
      },
    },
    /** Report a new fix, as the device would while the team moves. */
    move: () => listeners.forEach((l) => l(FIX)),
    get watching() {
      return listeners.length > 0;
    },
  };
}

function view(overrides: Partial<RegroupView> = {}): RegroupView {
  return {
    round: 1,
    calledBack: true,
    fenced: true,
    roundStartedAt: 0,
    roundEndsAt: 600_000,
    teams: [
      { teamId: 'A', name: 'Reds', status: 'ready' },
      { teamId: 'B', name: 'Blues', status: 'shooting' },
    ],
    readyCount: 1,
    teamCount: 2,
    allReady: false,
    me: { teamId: 'B', status: 'heading_back', done: 5, goal: 5 },
    ...overrides,
  };
}

const render_ = (v: RegroupView | null, props: Record<string, unknown> = {}) =>
  render(
    <ReturnScreen
      gameId="g1"
      mode="photo_chase"
      isHost={false}
      regroup={v}
      location={still}
      refresh={() => {}}
      {...props}
    />,
  );

describe('ReturnScreen — the roster', () => {
  it('shows every team and what it is doing', () => {
    render_(view());
    expect(screen.getByText('Reds')).toBeTruthy();
    expect(screen.getByText('Ready for round 2')).toBeTruthy();
    expect(screen.getByText('Blues')).toBeTruthy();
    expect(screen.getByText('Still taking pictures')).toBeTruthy();
  });

  it('counts how many teams are still out', () => {
    render_(view());
    expect(screen.getByText('1 teams still out')).toBeTruthy();
  });

  it('says so once everyone is back', () => {
    render_(view({ allReady: true, readyCount: 2 }));
    expect(screen.getByText('Every team is back.')).toBeTruthy();
  });

  it('does not promise a fence the game does not have', () => {
    render_(view({ fenced: false }));
    expect(screen.getByText('Check in when your team is back at the start.')).toBeTruthy();
  });

  // The camera preview must stay visible: this screen sits over it like the
  // shooting screens, and `Screen` would paint it out.
  it('is built on the viewfinder frame, not an opaque screen', () => {
    render_(view());
    expect(screen.getByTestId('viewfinder-frame')).toBeTruthy();
  });
});

describe('ReturnScreen — checking in', () => {
  it('sends the fix when the team presses the button', async () => {
    render_(view());
    fireEvent.click(screen.getByRole('button', { name: "We're back at the start" }));

    await waitFor(() => expect(checkIn).toHaveBeenCalled());
    expect(checkIn.mock.calls[0]![1]).toMatchObject({ location: FIX });
  });

  it('refuses to offer the button while the team is still shooting', () => {
    render_(view({ me: { teamId: 'B', status: 'shooting', done: 2, goal: 5 } }));
    // Disabled with the reason as its label — the reason is the useful part.
    expect(screen.getByRole('button', { name: 'Finish your photos first — 2 of 5' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: "We're back at the start" })).toBeNull();
  });

  it('stops offering it once the team is in', () => {
    render_(view({ me: { teamId: 'B', status: 'ready', done: 5, goal: 5 } }));
    expect(screen.getByRole('button', { name: 'Checked in' })).toBeTruthy();
  });

  it('keeps a rejected check-in visible and retryable', async () => {
    const { ApiError } = await import('@photochase/client');
    checkIn.mockRejectedValue(new ApiError(400, 'You are not at the start point yet — about 200 m to go.'));
    render_(view());

    fireEvent.click(screen.getByRole('button', { name: "We're back at the start" }));

    // The team may still be walking: the message has to say how far, and the
    // button has to still be there.
    expect(await screen.findByText('You are not at the start point yet — about 200 m to go.')).toBeTruthy();
    expect(screen.getByRole('button', { name: "We're back at the start" })).toBeTruthy();
  });

  it('gives a judge the roster and no check-in button', () => {
    render_(view({ me: null }));
    expect(screen.getByText('Reds')).toBeTruthy();
    expect(screen.queryByRole('button', { name: "We're back at the start" })).toBeNull();
  });
});

describe('ReturnScreen — automatic check-in', () => {
  it('checks the team in on a fix, with no tap', async () => {
    const w = walking();
    render_(view(), { location: w.source });

    expect(w.watching).toBe(true);
    await act(async () => {
      w.move();
    });

    await waitFor(() => expect(checkIn).toHaveBeenCalled());
    expect(checkIn.mock.calls[0]![1]).toMatchObject({ location: FIX, auto: true });
  });

  it('says nothing when an automatic attempt is refused', async () => {
    const { ApiError } = await import('@photochase/client');
    checkIn.mockRejectedValue(new ApiError(400, 'You are not at the start point yet — about 300 m to go.'));
    const w = walking();
    render_(view(), { location: w.source });

    await act(async () => {
      w.move();
    });

    // Otherwise this flashes every ten seconds for the whole walk back, which is
    // noise dressed up as feedback. Only a deliberate press earns an explanation.
    await waitFor(() => expect(checkIn).toHaveBeenCalled());
    expect(screen.queryByText(/300 m to go/)).toBeNull();
  });

  it('does not watch while the team is still shooting', () => {
    // At kickoff every team is standing on the start point with no photos taken.
    // A watch armed then would check the whole field in before the game began.
    const w = walking();
    render_(view({ me: { teamId: 'B', status: 'shooting', done: 0, goal: 5 } }), { location: w.source });
    expect(w.watching).toBe(false);
  });

  it('stops watching once the team is in', () => {
    const w = walking();
    render_(view({ me: { teamId: 'B', status: 'ready', done: 5, goal: 5 } }), { location: w.source });
    expect(w.watching).toBe(false);
  });

  it('throttles repeated fixes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const w = walking();
    render_(view(), { location: w.source });

    await act(async () => {
      w.move();
      w.move();
      w.move();
    });
    await waitFor(() => expect(checkIn).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
      w.move();
    });
    expect(checkIn).toHaveBeenCalledTimes(2);
  });
});

describe('ReturnScreen — the host', () => {
  const asHost = (v: RegroupView) => render_(v, { isHost: true });

  it('cannot start Round 2 while a team is out, and says how many', () => {
    asHost(view());
    expect(screen.getByRole('button', { name: 'Waiting for 1 teams' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start round 2' })).toBeNull();
  });

  it('can start Round 2 once everyone is back', async () => {
    asHost(view({ allReady: true, readyCount: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Start round 2' }));

    await waitFor(() => expect(advanceGame).toHaveBeenCalled());
    expect(advanceGame.mock.calls[0]!.slice(0, 2)).toEqual(['g1', 'COMPLETE_RETURN1']);
  });

  it('needs two taps to start without a missing team', async () => {
    asHost(view());
    fireEvent.click(screen.getByRole('button', { name: 'Start without them' }));

    // Forcing costs those teams their return bonus, so it is not one tap.
    expect(screen.getByText('Start anyway?')).toBeTruthy();
    expect(advanceGame).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Start without them' }));
    await waitFor(() => expect(advanceGame).toHaveBeenCalled());
    expect(advanceGame.mock.calls[0]![2]).toEqual({ force: true });
  });

  it('offers to call teams back while the round is still running', async () => {
    asHost(view({ calledBack: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Call teams back' }));

    await waitFor(() => expect(advanceGame).toHaveBeenCalled());
    expect(advanceGame.mock.calls[0]![1]).toBe('END_ROUND1');
  });

  it('sends a scavenger hunt to rating instead of Round 2', () => {
    // One round, so its return leads somewhere else entirely.
    render_(view({ allReady: true, readyCount: 2 }), { isHost: true, mode: 'scavenger_hunt' });
    expect(screen.getByRole('button', { name: 'Go to rating' })).toBeTruthy();
  });

  it('reports a refused advance', async () => {
    const { ApiError } = await import('@photochase/client');
    advanceGame.mockRejectedValue(new ApiError(400, '1 team has not checked in at the start point yet.'));
    asHost(view({ allReady: true, readyCount: 2 }));

    fireEvent.click(screen.getByRole('button', { name: 'Start round 2' }));
    expect(await screen.findByText('1 team has not checked in at the start point yet.')).toBeTruthy();
  });

  it('shows a connecting state before the roster arrives', () => {
    render_(null);
    expect(screen.getByText('Head back to the start')).toBeTruthy();
  });
});
