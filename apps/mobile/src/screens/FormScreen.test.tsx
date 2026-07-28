import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormScreen } from './FormScreen.js';

/**
 * Layout is not testable in jsdom, but the two structural facts that make a
 * keyboard screen usable are — and both were wrong before this existed: the
 * action sat inside the scroll area where the keyboard covered it, and taps
 * were not allowed through while the keyboard was up.
 */

afterEach(cleanup);

describe('FormScreen', () => {
  it('keeps the action out of the scroll area, where the keyboard cannot cover it', () => {
    render(
      <FormScreen action={<span>Create game</span>}>
        <span>a setting</span>
      </FormScreen>,
    );

    const scroll = screen.getByTestId('scrollview');
    expect(within(scroll).getByText('a setting')).toBeTruthy();
    expect(within(scroll).queryByText('Create game')).toBeNull();
    expect(screen.getByText('Create game')).toBeTruthy();
  });

  it('lets a tap through while the keyboard is open', () => {
    // Without this the first tap only dismisses the keyboard, so choosing an
    // option took two taps and looked like the first had failed.
    render(
      <FormScreen>
        <span>content</span>
      </FormScreen>,
    );
    expect(screen.getByTestId('scrollview').getAttribute('data-persist-taps')).toBe('handled');
  });

  it('leaves the keyboard alone while scrolling on Android', () => {
    // Android apps keep the keyboard up when you scroll. `on-drag` snapped it
    // away mid-gesture, which is not what any other Android app does.
    render(
      <FormScreen>
        <span>content</span>
      </FormScreen>,
    );
    // The shim reports Platform.OS as android.
    expect(screen.getByTestId('scrollview').getAttribute('data-dismiss-mode')).toBe('none');
  });

  it('works with no action at all', () => {
    render(
      <FormScreen>
        <span>content</span>
      </FormScreen>,
    );
    expect(screen.getByText('content')).toBeTruthy();
  });
});
