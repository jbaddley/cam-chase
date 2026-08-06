import { describe, expect, it } from 'vitest';
import { layoutViewport, placementFor } from './viewport.js';

/** A box to lay squares out in. Offset defaults to the origin (the whole window). */
const box = (width: number, height: number, left = 0, top = 0) => ({ left, top, width, height });
const PORTRAIT = box(400, 800);
const LANDSCAPE = box(800, 400);

/** Every pane the game shows must be square, or the comparison is skewed. */
const square = (r: { width: number; height: number }) => expect(r.width).toBe(r.height);

describe('layoutViewport — centred', () => {
  it('takes the largest square the box holds', () => {
    const { camera, other } = layoutViewport('center', PORTRAIT);
    square(camera);
    expect(camera.width).toBe(400);
    // Centred vertically in an 800-tall box.
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
    // Half of 800 is 400, and the box is 400 wide, so the square is 400.
    expect(camera.width).toBe(400);
    expect(camera.top).toBe(400);
  });

  it('is bounded by the half height on a tall narrow box', () => {
    const { camera, other } = layoutViewport('bottom', box(400, 600));
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

  it('is bounded by the half width on a wide short box', () => {
    const { camera } = layoutViewport('right', box(600, 400));
    expect(camera.width).toBe(300); // half of 600
    expect(camera.top).toBe(50);
  });
});

/**
 * The reason the layout takes a box rather than a window: on Round 2 the box is
 * the region *between* the header and the shutter, offset down the screen — and
 * the camera outside the safe area needs that same region in window space. A
 * layout that dropped the offset put the square back under the chrome, which was
 * the whole defect. These pin the offset into every rect.
 */
describe('layoutViewport — offset box (the region the chrome leaves)', () => {
  // A 400×460 band starting 140 px down: a header above, a shutter below.
  const region = box(400, 460, 0, 140);

  it('centres within the band and carries its top offset', () => {
    const { camera } = layoutViewport('center', region);
    square(camera);
    expect(camera.width).toBe(400);
    expect(camera.left).toBe(0);
    // Centred in the 460-tall band AND pushed down by the band's own top.
    expect(camera.top).toBe(140 + (460 - 400) / 2); // 170, not 30
  });

  it('splits the band into two squares that both stay inside it', () => {
    const { camera, other } = layoutViewport('bottom', region);
    square(camera);
    square(other!);
    expect(camera.width).toBe(230); // half the band's height
    expect(camera.width).toBe(other!.width);
    // Original in the upper half, camera in the lower — both below the header…
    expect(other!.top).toBeGreaterThanOrEqual(region.top);
    expect(camera.top).toBeGreaterThan(other!.top);
    // …and the lower square's bottom does not spill past the band into the shutter.
    expect(camera.top + camera.height).toBeLessThanOrEqual(region.top + region.height);
  });

  it('carries a horizontal offset in a landscape split', () => {
    const inset = box(800, 400, 30, 0); // a 30 px left inset
    const { camera, other } = layoutViewport('right', inset);
    expect(other!.left).toBeGreaterThanOrEqual(inset.left);
    expect(camera.left).toBeGreaterThan(other!.left);
    expect(camera.left + camera.width).toBeLessThanOrEqual(inset.left + inset.width);
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
