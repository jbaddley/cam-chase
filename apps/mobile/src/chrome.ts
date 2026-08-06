import { createContext, useContext, useEffect } from 'react';

/**
 * A screen's request to hide the app's chrome — the game bar the shell draws
 * above every in-game screen — so it can go fullscreen.
 *
 * The bar lives in the shell (`GameRouter`), above and outside the screen, so a
 * screen cannot cover it from the inside; it has to ask. This is the same
 * "declare it and the owner obeys" shape as the viewfinder and camera-rect
 * contexts: the screen states what it wants, the shell complies, and no screen
 * reaches up to mutate the shell directly. The default is a no-op, so a screen
 * rendered with no shell above it (tests, previews) still works.
 */
export const HideChromeContext = createContext<(hidden: boolean) => void>(() => {});

/** Hide the shell chrome while `hidden` is true, and restore it on unmount. */
export function useHideChrome(hidden: boolean): void {
  const setHidden = useContext(HideChromeContext);
  useEffect(() => {
    setHidden(hidden);
    // Restoring on the way out is the important half: a screen that unmounts
    // mid-fullscreen (the phase poll moves the player on) must not leave the
    // next screen with no way out.
    return () => setHidden(false);
  }, [setHidden, hidden]);
}
