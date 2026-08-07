import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { radius, space } from '../theme.js';
import { ViewfinderLayoutContext } from '../viewfinder.js';

/**
 * The frame for a screen you shoot from: controls over a live viewfinder.
 *
 * The shooting screens used `Screen`, which paints the app's surface colour
 * across the whole window. The camera runs behind it, full-bleed and completely
 * invisible — an opaque sheet over a viewfinder. That is the bug this exists to
 * make structurally impossible: there is no background here to set.
 *
 * Two things follow from "the player has to see what they are pointing at":
 *
 * - **The middle stays empty.** Text sits on its own local scrim rather than the
 *   window-wide wash the camera stage used to apply, because a 55% white sheet
 *   over the entire preview is only a slightly better viewfinder than no
 *   preview. The scrim covers the words and nothing else.
 * - **The shutter follows the grip.** Held upright it belongs at the bottom;
 *   turned sideways that is the wrong edge entirely, and the thumb is on the
 *   right. So landscape moves the action into a side rail rather than just
 *   letting the portrait column squash.
 *
 * `landscape` is a prop with the window as its default, following the same rule
 * as the camera and the authorizer: the screens take their environment rather
 * than reaching for it, so both arrangements are reachable under the test
 * harness. Whether either one *looks* right is a device question — the harness
 * drops styles, and a static render can no more validate this than it could the
 * keyboard inset.
 */
export function ViewfinderFrame({
  children,
  action,
  backdrop,
  landscape,
}: {
  children: ReactNode;
  action?: ReactNode;
  /**
   * Full-bleed content behind the controls, between them and the camera — the
   * onion-skinned original, in practice. It lives here rather than as a sibling
   * of the frame so it is inside the layout provider: a backdrop that has to
   * arrange itself sideways can read the same decision the frame made, instead
   * of measuring the window a second time and disagreeing.
   */
  backdrop?: ReactNode;
  /** Defaults to the real window; passed explicitly by tests. */
  landscape?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const wide = landscape ?? width > height;
  // Stable so a child reading the layout does not re-render on every frame.
  const layout = useMemo(() => ({ landscape: wide }), [wide]);

  return (
    <ViewfinderLayoutContext.Provider value={layout}>
      {backdrop ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {backdrop}
        </View>
      ) : null}
      <View
        testID={wide ? 'viewfinder-frame-landscape' : 'viewfinder-frame'}
        style={[styles.frame, wide && styles.frameLandscape]}
      >
        <View style={[styles.info, wide && styles.infoLandscape]}>{children}</View>
        {action ? (
          <View
            testID={wide ? 'viewfinder-action-rail' : 'viewfinder-action-bar'}
            style={[styles.action, wide && styles.actionLandscape]}
          >
            {action}
          </View>
        ) : null}
      </View>
    </ViewfinderLayoutContext.Provider>
  );
}

const styles = StyleSheet.create({
  /**
   * No `backgroundColor`, deliberately and permanently: this frame's whole job
   * is to not be one. `space-between` is what puts the readout against one edge
   * and the shutter against the other in both arrangements.
   */
  frame: { flex: 1, justifyContent: 'space-between', padding: space.lg, gap: space.md },
  frameLandscape: { flexDirection: 'row' },

  /** The scrim, sized to the words rather than the window. */
  info: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.xs,
  },
  // Never more than half the frame sideways, or the readout crowds out the shot.
  infoLandscape: { flexShrink: 1, maxWidth: '50%' },

  /** `alignItems: center` so the round shutter sits in the middle of the bottom
      bar upright — a fixed-width circle would otherwise hug the left edge. */
  action: { gap: space.sm, alignItems: 'center' },
  /** Centred against the right edge, where the thumb already is. */
  actionLandscape: { justifyContent: 'center', flexShrink: 0, minWidth: 120 },
});
