import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNT_UP_MS, useCountUp } from './motion.js';

/**
 * The count-up is the only animation in the app that can produce a *wrong*
 * result rather than an ugly one: it renders a number people are reading to
 * find out who won. So what these pin is that it always lands exactly on the
 * real score.
 */

function Score({ total, enabled }: { total: number; enabled?: boolean }) {
  return <span>{useCountUp(total, enabled)}</span>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('useCountUp', () => {
  it('starts at zero', () => {
    render(<Score total={240} />);
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('lands exactly on the target, not near it', () => {
    // An eased fraction would finish a point or two short, and a scoreboard
    // that disagrees with the result is worse than one that does not move.
    render(<Score total={237} />);
    advance(COUNT_UP_MS + 50);
    expect(screen.getByText('237')).toBeTruthy();
  });

  it('is somewhere in between along the way', () => {
    render(<Score total={1000} />);
    advance(COUNT_UP_MS / 2);

    const shown = Number(screen.getByText(/^\d+$/).textContent);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(1000);
  });

  it('eases out, so it is past halfway at the halfway point', () => {
    render(<Score total={1000} />);
    advance(COUNT_UP_MS / 2);
    expect(Number(screen.getByText(/^\d+$/).textContent)).toBeGreaterThan(500);
  });

  it('shows the number immediately when disabled', () => {
    // Nothing to celebrate yet: counting up from zero to zero, then jumping,
    // would look like a glitch.
    render(<Score total={240} enabled={false} />);
    expect(screen.getByText('240')).toBeTruthy();
  });

  it('stops its timer when unmounted', () => {
    const view = render(<Score total={500} />);
    view.unmount();
    // Nothing left to fire; a surviving interval would set state on a gone
    // component every 33ms for the rest of the session.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles a zero score without dividing by anything', () => {
    render(<Score total={0} />);
    advance(COUNT_UP_MS + 50);
    expect(screen.getByText('0')).toBeTruthy();
  });
});
