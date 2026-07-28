import { render, screen, act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The reason this hook exists is worth restating: the app runs edge-to-edge, so
 * Android never resizes the window for the keyboard and `KeyboardAvoidingView`
 * has nothing to react to. Anything pinned to the bottom — the Create button —
 * ends up underneath the keyboard. These tests drive the keyboard events the
 * device would send.
 */

const listeners: Record<string, (e: { endCoordinates: { height: number } }) => void> = {};
const removed: string[] = [];
const platform = { OS: 'android' };

vi.mock('react-native', async () => {
  const shim = await vi.importActual<Record<string, unknown>>('../test/react-native-shim.js');
  return {
    ...shim,
    Platform: platform,
    Keyboard: {
      addListener: (event: string, handler: (e: { endCoordinates: { height: number } }) => void) => {
        listeners[event] = handler;
        return { remove: () => removed.push(event) };
      },
    },
  };
});

const { useKeyboardInset } = await import('./useKeyboardInset.js');

function Probe() {
  return <span>inset:{useKeyboardInset()}</span>;
}

afterEach(() => {
  cleanup();
  removed.length = 0;
  for (const key of Object.keys(listeners)) delete listeners[key];
  platform.OS = 'android';
});

const show = (height: number) =>
  act(() => listeners['keyboardDidShow']!({ endCoordinates: { height } }));
const hide = () => act(() => listeners['keyboardDidHide']!({ endCoordinates: { height: 0 } }));

describe('useKeyboardInset', () => {
  it('starts at nothing', () => {
    render(<Probe />);
    expect(screen.getByText('inset:0')).toBeTruthy();
  });

  it('reports the keyboard height so the action can clear it', () => {
    render(<Probe />);
    show(320);
    expect(screen.getByText('inset:320')).toBeTruthy();
  });

  it('goes back to nothing when the keyboard closes', () => {
    render(<Probe />);
    show(320);
    hide();
    expect(screen.getByText('inset:0')).toBeTruthy();
  });

  it('releases both listeners on unmount', () => {
    const view = render(<Probe />);
    view.unmount();
    expect(removed.sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);
  });

  it('stays out of the way on iOS, where KeyboardAvoidingView handles it', () => {
    // Both applying padding would double-count and leave a gap the height of
    // the keyboard above it.
    platform.OS = 'ios';
    render(<Probe />);

    expect(screen.getByText('inset:0')).toBeTruthy();
    // Nothing is even subscribed, so there is no second opinion to conflict.
    expect(Object.keys(listeners)).toEqual([]);
  });
});
