import { Image, StyleSheet, View } from 'react-native';
import type { Rect } from '../viewport.js';

/** How the original is shown while you line up the recreation. */
export type ChaseViewMode = 'hidden' | 'overlay' | 'split';

/** The onion-skin levels offered, as fractions. */
export const OVERLAY_LEVELS = [0.25, 0.4, 0.6, 0.8] as const;

/**
 * The original photo, placed against the square the camera is shooting.
 *
 * The rects come from the screen, which computes one layout for the region its
 * chrome leaves and hands the camera and this the *same* squares — so the two
 * can never disagree, which is exactly what went wrong when each measured its own
 * from a different origin. Both `camera` and `other` are in screen space, and
 * this is rendered inside a full-screen layer, so the absolute position it sets
 * lands on the same pixels the native camera window does.
 *
 * - **overlay** — the original sits *on* the camera square, edge for edge, so a
 *   shape lined up in the ghost is a shape lined up in the shot.
 * - **split** — the original sits in `other`, *beside* the camera: stacked when
 *   the phone is upright, side by side when it is turned. Both squares are fully
 *   visible because the region was split to hold them both.
 * - **hidden** — nothing, for a clean look at the scene.
 */
export function ChaseView({
  uri,
  mode,
  opacity,
  camera,
  other,
}: {
  uri: string | null;
  mode: ChaseViewMode;
  /** Onion-skin level, 0–1. Ignored unless `mode` is `overlay`. */
  opacity: number;
  /** The camera square, screen space. The original sits here in overlay. */
  camera: Rect;
  /** The original's square in a split, screen space. Null unless splitting. */
  other: Rect | null;
}) {
  if (uri === null || mode === 'hidden') return null;

  const box = mode === 'split' ? other : camera;
  if (!box) return null;

  return (
    <View
      testID={mode === 'split' ? 'chase-original-beside' : 'chase-original-over'}
      style={[
        styles.pane,
        { left: box.left, top: box.top, width: box.width, height: box.height },
        mode === 'overlay' && { opacity },
      ]}
    >
      {/* `cover`, not `contain`: the pane is already the photo's aspect ratio, so
          filling it shows the whole picture without letterboxing inside a box
          that is the right shape anyway. */}
      <Image testID="chase-original" source={{ uri }} resizeMode="cover" style={StyleSheet.absoluteFill} />
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { position: 'absolute', overflow: 'hidden' },
});
