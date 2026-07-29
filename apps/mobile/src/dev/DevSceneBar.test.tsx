import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevSceneBar } from './DevSceneBar.js';

/**
 * Styling is dropped under jsdom, so what these guard is the structure: the bar
 * only exists in a development bundle, it is a lone toggle until the harness is
 * on, and it exposes the scene chips only once it is. The toggle's own effect on
 * the flag lives in `fixture-toggle.test.ts`; here it just has to fire.
 */

beforeEach(() => {
  // The bar renders only in a development bundle; vitest is neither, so stub it.
  vi.stubGlobal('__DEV__', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('DevSceneBar', () => {
  it('renders nothing outside a development bundle', () => {
    vi.unstubAllGlobals();
    const { container } = render(<DevSceneBar enabled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('is a lone off toggle until the harness is switched on', () => {
    render(<DevSceneBar enabled={false} />);

    expect(screen.getByTestId('dev-fixtures-toggle').textContent).toBe('FIXTURES OFF');
    // No scenes to jump between while it is off.
    expect(screen.queryByTestId('dev-scene-exit')).toBeNull();
    expect(screen.queryByTestId('dev-scene-lobby')).toBeNull();
  });

  it('exposes the scene chips once it is on', () => {
    render(<DevSceneBar enabled inGame />);

    expect(screen.getByTestId('dev-fixtures-toggle').textContent).toBe('FIXTURES ON');
    expect(screen.getByTestId('dev-scene-exit')).toBeTruthy();
    expect(screen.getByTestId('dev-scene-lobby')).toBeTruthy();
  });

  it('fires the toggle when the switch is pressed', () => {
    const onToggle = vi.fn();
    render(<DevSceneBar enabled={false} onToggle={onToggle} />);

    fireEvent.click(screen.getByTestId('dev-fixtures-toggle'));
    expect(onToggle).toHaveBeenCalled();
  });
});
