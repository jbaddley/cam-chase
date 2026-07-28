import { Image, StyleSheet, View } from 'react-native';
import { useViewfinderLayout } from '../viewfinder.js';

/** How the original is shown while you line up the recreation. */
export type ChaseViewMode = 'hidden' | 'overlay' | 'side_by_side';

/** The onion-skin levels offered, as fractions. */
export const OVERLAY_LEVELS = [0.25, 0.4, 0.6, 0.8] as const;

/**
 * The original photo, over the live viewfinder, in one of three arrangements.
 *
 * Matching a photograph is a physical task — you move until the shapes line up —
 * so the useful question is not "what does the original look like" but "where do
 * I stand". Each mode answers it differently and each is the right answer at a
 * different moment, which is why this is a choice rather than a fixed layout:
 *
 * - **hidden** — nothing at all, so the frame is clean for the actual shot. You
 *   have already looked; now you need to see what the camera sees.
 * - **overlay** — the original ghosted over the preview. This is the one that
 *   actually aligns a composition, and the reason the level is adjustable is
 *   that the right amount depends entirely on how busy the scene is.
 * - **side_by_side** — landscape only, the original filling one half. Comparing
 *   two whole images beats squinting at a superimposition when the subject is
 *   detailed rather than geometric.
 *
 * **Side by side does not crop your photo.** The camera is still capturing the
 * full frame behind this; the split is a place to look, not a viewport. Every
 * player will assume otherwise at least once, and no test can catch that
 * misunderstanding — only the wording can.
 */
export function ChaseView({
  uri,
  mode,
  opacity,
}: {
  uri: string | null;
  mode: ChaseViewMode;
  /** Onion-skin level, 0–1. Ignored unless `mode` is `overlay`. */
  opacity: number;
}) {
  // Read rather than passed: this renders as the frame's backdrop, so it is
  // inside the provider and sees the arrangement the frame already chose.
  const { landscape } = useViewfinderLayout();

  // Nothing to show, or nothing wanted. Either way the viewfinder is clear.
  if (uri === null || mode === 'hidden') return null;

  if (mode === 'side_by_side' && landscape) {
    return (
      <View style={styles.split}>
        <Image testID="chase-original" source={{ uri }} resizeMode="contain" style={styles.half} />
        {/* The other half is deliberately empty: that is the live preview. */}
        <View style={styles.half} />
      </View>
    );
  }

  // Taps pass through because `ViewfinderFrame` renders the backdrop inside a
  // `pointerEvents="none"` wrapper. That is load-bearing, not incidental: a
  // full-bleed absolute image otherwise swallows every tap, including the
  // shutter — the one control the screen exists to offer.
  return (
    <Image
      testID="chase-original"
      source={{ uri }}
      resizeMode="contain"
      style={[StyleSheet.absoluteFill, { opacity }]}
    />
  );
}

const styles = StyleSheet.create({
  split: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  half: { flex: 1 },
});
