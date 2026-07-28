import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * How far the keyboard currently covers the bottom of the screen.
 *
 * Needed because `KeyboardAvoidingView` does nothing on Android here. The app
 * runs edge-to-edge (`edgeToEdgeEnabled` in app.json, and mandatory from
 * Android 15), and an edge-to-edge window is **not** resized when the keyboard
 * opens — the app keeps its full height and the keyboard is drawn over it. So
 * there is no resize for `KeyboardAvoidingView` to react to, and anything
 * pinned to the bottom sits underneath the keyboard.
 *
 * Measuring it directly works whatever the window does, which is the point:
 * the keyboard events carry the height even when nothing resizes.
 *
 * iOS is left to `KeyboardAvoidingView`, which handles it correctly there
 * including the home-indicator inset, so this returns 0 and the two do not
 * fight over the same space.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    // `didShow` rather than `willShow`: Android only reports the real height
    // once the keyboard is up, and guessing early puts the action in the wrong
    // place for the length of the animation.
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      setInset(event.endCoordinates.height);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => setInset(0));

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return inset;
}
