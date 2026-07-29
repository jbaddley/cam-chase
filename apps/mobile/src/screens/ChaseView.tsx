import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { layoutViewport, placementFor } from '../viewport.js';

/** How the original is shown while you line up the recreation. */
export type ChaseViewMode = 'hidden' | 'overlay' | 'split';

/** The onion-skin levels offered, as fractions. */
export const OVERLAY_LEVELS = [0.25, 0.4, 0.6, 0.8] as const;

/**
 * The original photo, placed against the square the camera is shooting.
 *
 * Every capture is square, so the preview is a square window and this draws the
 * original at exactly the same size — which is what makes the two modes below
 * mean what they say:
 *
 * - **overlay** — the original sits *on* the camera square, edge for edge. It is
 *   exact rather than approximate now: two squares of identical size, so a shape
 *   lined up in the ghost is a shape lined up in the shot. When the camera filled
 *   the screen and the original was letterboxed into it, it never quite was.
 * - **split** — the original sits *beside* the camera square: stacked when the
 *   phone is upright, side by side when it is turned. The camera is clipped to
 *   its own half, so what you see in that half is the whole of what you capture.
 *   This is the part that was wrong before: the original took half the screen
 *   while the camera quietly kept all of it.
 * - **hidden** — nothing, for a clean look at the scene.
 */
export function ChaseView({
  uri,
  mode,
  opacity,
  landscape,
}: {
  uri: string | null;
  mode: ChaseViewMode;
  /** Onion-skin level, 0–1. Ignored unless `mode` is `overlay`. */
  opacity: number;
  /** Passed in rather than read from context: this no longer sits inside the frame. */
  landscape: boolean;
}) {
  const window = useWindowDimensions();

  if (uri === null || mode === 'hidden') return null;

  // The same layout the camera is using, so the two panes cannot disagree.
  const { camera, other } = layoutViewport(placementFor(mode, landscape), window);
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
