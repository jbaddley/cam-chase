/**
 * Where the square viewfinder sits, and how big it is.
 *
 * Every photo this game takes is square. That is a rule about the *game*, not
 * about the camera: a chase is a comparison, and comparing a portrait original
 * against a landscape recreation is a worse comparison for reasons that have
 * nothing to do with how well anyone framed it. Squares make the two directly
 * comparable, and they make the onion skin exact instead of approximate, because
 * both panes are then the same shape.
 *
 * So the preview is a square window, not the whole screen, and this module says
 * where. Pure arithmetic, kept out of the camera so it can be reasoned about and
 * tested without a device — the placement rules are the part that is easy to get
 * subtly wrong and impossible to see in a DOM harness.
 */

/** Where the camera square sits. The split placements leave room for the original. */
export type CameraPlacement =
  /** Centred: Round 1, and Round 2 with the original hidden or overlaid. */
  | 'center'
  /** Lower half, portrait split — the original takes the upper half. */
  | 'bottom'
  /** Right half, landscape split — the original takes the left. */
  | 'right';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Window {
  width: number;
  height: number;
}

/**
 * The two squares of a split, and the single square otherwise.
 *
 * `other` is where the original goes, and it is exactly the same size as the
 * camera square — which is the whole point. A split where the panes differ in
 * size is a comparison with a handicap built into it.
 */
export interface Viewport {
  camera: Rect;
  /** Null unless the placement is a split. */
  other: Rect | null;
}

/**
 * Lay out the viewport for a placement in a window.
 *
 * Centred takes the largest square the window holds. A split halves the window
 * along its long axis and takes the largest square each half holds, so the two
 * panes match. Both are centred within their half, because a square pinned to an
 * edge reads as a cropping mistake.
 */
export function layoutViewport(placement: CameraPlacement, window: Window): Viewport {
  const { width, height } = window;

  if (placement === 'center') {
    const side = Math.min(width, height);
    return { camera: centred(side, 0, 0, width, height), other: null };
  }

  if (placement === 'bottom') {
    // Portrait split: original above, camera below.
    const half = height / 2;
    const side = Math.min(width, half);
    return {
      camera: centred(side, 0, half, width, half),
      other: centred(side, 0, 0, width, half),
    };
  }

  // Landscape split: original left, camera right.
  const half = width / 2;
  const side = Math.min(half, height);
  return {
    camera: centred(side, half, 0, half, height),
    other: centred(side, 0, 0, half, height),
  };
}

/** A square of `side`, centred inside the box at (bx, by, bw, bh). */
function centred(side: number, bx: number, by: number, bw: number, bh: number): Rect {
  return {
    left: bx + (bw - side) / 2,
    top: by + (bh - side) / 2,
    width: side,
    height: side,
  };
}

/**
 * The placement a chase screen wants, given its mode and the orientation.
 *
 * Split only ever means "beside", and which side depends on how the phone is
 * held: stacked when upright, side by side when turned. It is one mode with two
 * arrangements rather than two modes, because from the player's point of view it
 * is one idea — show me both at once.
 */
export function placementFor(
  mode: 'hidden' | 'overlay' | 'split',
  landscape: boolean,
): CameraPlacement {
  if (mode !== 'split') return 'center';
  return landscape ? 'right' : 'bottom';
}
