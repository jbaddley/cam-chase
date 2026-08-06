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
 * Lay out the viewport for a placement inside a box, in the box's own
 * coordinates.
 *
 * The box is the region the pictures may use — for Round 2 that is the space
 * *between* the header and the shutter, not the whole screen, which is the bug
 * this fixes: the camera used to lay out against the full window while the chrome
 * sat in those same pixels, so a split put the square under the header and the
 * shutter, and an overlay could not line up with an original measured from a
 * different origin. Give both the camera and the original the identical box and
 * the two can no longer disagree.
 *
 * Centred takes the largest square the box holds. A split halves the box along
 * its long axis and takes the largest square each half holds, so the two panes
 * match. Both are centred within their half, because a square pinned to an edge
 * reads as a cropping mistake. Every rect returned is in the same coordinate
 * space as `box` — pass a screen-space box and get screen-space rects.
 */
export function layoutViewport(placement: CameraPlacement, box: Rect): Viewport {
  const { left, top, width, height } = box;

  if (placement === 'center') {
    const side = Math.min(width, height);
    return { camera: centred(side, left, top, width, height), other: null };
  }

  if (placement === 'bottom') {
    // Portrait split: original above, camera below. Each square is the largest
    // its half holds, so both are fully visible — capped by half the height when
    // the box is tall, by the width when it is wide.
    const half = height / 2;
    const side = Math.min(width, half);
    return {
      camera: centred(side, left, top + half, width, half),
      other: centred(side, left, top, width, half),
    };
  }

  // Landscape split: original left, camera right.
  const half = width / 2;
  const side = Math.min(half, height);
  return {
    camera: centred(side, left + half, top, half, height),
    other: centred(side, left, top, half, height),
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
