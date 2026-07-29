import { describe, expect, it } from 'vitest';
import { layoutViewport, placementFor } from './viewport.js';

const PORTRAIT = { width: 400, height: 800 };
const LANDSCAPE = { width: 800, height: 400 };

/** Every pane the game shows must be square, or the comparison is skewed. */
const square = (r: { width: number; height: number }) => expect(r.width).toBe(r.height);

describe('layoutViewport — centred', () => {
  it('takes the largest square the window holds', () => {
    const { camera, other } = layoutViewport('center', PORTRAIT);
    square(camera);
    expect(camera.width).toBe(400);
    // Centred vertically in an 800-tall window.
    expect(camera.top).toBe(200);
    expect(camera.left).toBe(0);
    expect(other).toBeNull();
  });

  it('is bounded by the short side in landscape', () => {
    const { camera } = layoutViewport('center', LANDSCAPE);
    square(camera);
    expect(camera.width).toBe(400);
    expect(camera.left).toBe(200);
    expect(camera.top).toBe(0);
  });
});

describe('layoutViewport — portrait split', () => {
  it('stacks two equal squares, original above and camera below', () => {
    const { camera, other } = layoutViewport('bottom', PORTRAIT);
    square(camera);
    square(other!);
    // A split whose panes differ in size is a comparison with a handicap.
    expect(camera.width).toBe(other!.width);
    expect(other!.top).toBeLessThan(camera.top);
  });

  it('sizes each pane to the half that holds it', () => {
    const { camera } = layoutViewport('bottom', PORTRAIT);
    // Half of 800 is 400, and the window is 400 wide, so the square is 400.
    expect(camera.width).toBe(400);
    expect(camera.top).toBe(400);
  });

  it('is bounded by the half height on a tall narrow window', () => {
    const { camera, other } = layoutViewport('bottom', { width: 400, height: 600 });
    expect(camera.width).toBe(300); // half of 600
    expect(camera.width).toBe(other!.width);
    // Centred in its half rather than pinned to an edge, which would read as a crop.
    expect(camera.left).toBe(50);
  });
});

describe('layoutViewport — landscape split', () => {
  it('puts two equal squares side by side, original on the left', () => {
    const { camera, other } = layoutViewport('right', LANDSCAPE);
    square(camera);
    square(other!);
    expect(camera.width).toBe(other!.width);
    expect(other!.left).toBeLessThan(camera.left);
  });

  it('sizes each pane to the half that holds it', () => {
    const { camera } = layoutViewport('right', LANDSCAPE);
    expect(camera.width).toBe(400); // min(800/2, 400)
    expect(camera.left).toBe(400);
  });

  it('is bounded by the half width on a wide short window', () => {
    const { camera } = layoutViewport('right', { width: 600, height: 400 });
    expect(camera.width).toBe(300); // half of 600
    expect(camera.top).toBe(50);
  });
});

describe('placementFor', () => {
  it('centres the camera whenever the original is not beside it', () => {
    expect(placementFor('hidden', false)).toBe('center');
    expect(placementFor('overlay', false)).toBe('center');
    // Overlay is exact precisely because both panes are the same centred square.
    expect(placementFor('overlay', true)).toBe('center');
  });

  it('splits along the long axis: stacked upright, side by side turned', () => {
    expect(placementFor('split', false)).toBe('bottom');
    expect(placementFor('split', true)).toBe('right');
  });
});
