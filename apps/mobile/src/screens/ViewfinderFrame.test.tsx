import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Body, Button, Title } from '../ui.js';
import { ViewfinderFrame } from './ViewfinderFrame.js';

/**
 * These are structure tests, and only structure tests. The harness drops
 * styles, so nothing here can tell you the frame is transparent or that the
 * preview reaches the edges of the glass — that was checked on a device, and
 * has to be. What they do pin down is which frame a shooting screen is built on
 * and which arrangement it chose, both of which are decisions in the code.
 */
describe('ViewfinderFrame', () => {
  it('renders its readout and its action', () => {
    render(
      <ViewfinderFrame action={<Button onPress={() => {}}>Take photo</Button>}>
        <Title>Round 1</Title>
        <Body muted>0 / 5 photos</Body>
      </ViewfinderFrame>,
    );

    expect(screen.getByText('Round 1')).toBeTruthy();
    expect(screen.getByText('0 / 5 photos')).toBeTruthy();
    expect(screen.getByText('Take photo')).toBeTruthy();
  });

  it('stands the action along the bottom when the phone is upright', () => {
    render(
      <ViewfinderFrame landscape={false} action={<Button onPress={() => {}}>Take photo</Button>}>
        <Title>Round 1</Title>
      </ViewfinderFrame>,
    );

    expect(screen.getByTestId('viewfinder-frame')).toBeTruthy();
    expect(screen.getByTestId('viewfinder-action-bar')).toBeTruthy();
    expect(screen.queryByTestId('viewfinder-action-rail')).toBeNull();
  });

  // Turned sideways the bottom edge is the wrong one — the thumb is on the
  // right — so this is a different arrangement rather than a squashed column.
  it('moves the action into a side rail when the phone is turned sideways', () => {
    render(
      <ViewfinderFrame landscape action={<Button onPress={() => {}}>Take photo</Button>}>
        <Title>Round 1</Title>
      </ViewfinderFrame>,
    );

    expect(screen.getByTestId('viewfinder-frame-landscape')).toBeTruthy();
    expect(screen.getByTestId('viewfinder-action-rail')).toBeTruthy();
    expect(screen.queryByTestId('viewfinder-action-bar')).toBeNull();
  });

  it('defaults to the window when no orientation is given', () => {
    render(
      <ViewfinderFrame action={<Button onPress={() => {}}>Take photo</Button>}>
        <Title>Round 1</Title>
      </ViewfinderFrame>,
    );

    // The harness reports a portrait phone.
    expect(screen.getByTestId('viewfinder-frame')).toBeTruthy();
  });

  it('renders without an action at all', () => {
    render(
      <ViewfinderFrame>
        <Title>Round 1</Title>
      </ViewfinderFrame>,
    );

    expect(screen.getByText('Round 1')).toBeTruthy();
    expect(screen.queryByTestId('viewfinder-action-bar')).toBeNull();
    expect(screen.queryByTestId('viewfinder-action-rail')).toBeNull();
  });
});
