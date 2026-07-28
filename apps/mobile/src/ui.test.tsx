import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Card, Pill } from './ui.js';

/**
 * Styling is not testable in jsdom and is not what these guard. What they guard
 * is the one piece of behaviour these components own: a disabled button must
 * not fire. Every screen now routes its actions through this, so a regression
 * here would let a half-filled form submit anywhere in the app.
 */

afterEach(cleanup);

describe('Button', () => {
  it('fires when pressed', () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Create game</Button>);

    fireEvent.click(screen.getByRole('button', { name: 'Create game' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const onPress = vi.fn();
    render(
      <Button onPress={onPress} disabled>
        Create game
      </Button>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create game' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('is still findable by its label when disabled, for tests and screen readers', () => {
    render(
      <Button onPress={vi.fn()} disabled>
        Need one more team
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Need one more team' })).toBeTruthy();
  });
});

describe('Card and Pill', () => {
  it('render whatever they are given', () => {
    render(
      <Card tone="highlight">
        <Pill>Lobby</Pill>
      </Card>,
    );
    expect(screen.getByText('Lobby')).toBeTruthy();
  });
});
