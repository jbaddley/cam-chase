/**
 * A DOM stand-in for the handful of React Native primitives these screens use.
 *
 * The RN toolchain is deliberately not installed (see the app README), so under
 * Vitest `react-native` is aliased to this module. Rendering to DOM lets
 * Testing Library drive the screens' real logic — state, effects, API calls,
 * conditional rendering — which is where the bugs live.
 *
 * It does not model native rendering or layout. Genuine RN-vs-DOM differences
 * are out of scope here and belong to Maestro on an EAS build (doc 05).
 */

import type { ComponentType, ReactNode } from 'react';
import { createElement } from 'react';

interface Styled {
  style?: unknown;
  children?: ReactNode;
  testID?: string;
}

/**
 * `testID` is forwarded so tests can find a structural container by name. That
 * is not a way in through the back door for layout: styles are still dropped,
 * and a component whose portrait and landscape arrangements differ only by
 * style is still indistinguishable here. What it buys is the ability to assert
 * *which* arrangement a component chose, and which frame a screen is built on —
 * questions about structure, which this shim does model.
 */
const box =
  (role?: string): ComponentType<Styled> =>
  ({ children, testID }) =>
    createElement('div', testID ?? role ? { 'data-testid': testID ?? role } : {}, children);

export const View = box();
/**
 * Scrolling itself is out of scope, but two props decide whether a screen with
 * a keyboard is usable at all, so they are surfaced as attributes for tests to
 * assert on. `keyboardShouldPersistTaps` in particular: without it the first
 * tap anywhere is spent dismissing the keyboard.
 */
export const ScrollView: ComponentType<
  Styled & {
    keyboardShouldPersistTaps?: string;
    keyboardDismissMode?: string;
    contentContainerStyle?: unknown;
  }
> = ({ children, keyboardShouldPersistTaps, keyboardDismissMode }) =>
  createElement(
    'div',
    {
      'data-testid': 'scrollview',
      'data-persist-taps': keyboardShouldPersistTaps ?? 'never',
      'data-dismiss-mode': keyboardDismissMode ?? 'none',
    },
    children,
  );

export const Text: ComponentType<Styled> = ({ children }) => createElement('span', {}, children);

/**
 * An `img` carrying the source uri, and nothing else that matters.
 *
 * `resizeMode`, `opacity` and every other question about how the image *looks*
 * are dropped, because this shim does not model style. Two onion-skin overlays
 * at 25% and 75% are the same DOM here — which is why the chase viewer states
 * the level in words the player can read, and its test asserts those words
 * rather than an opacity it cannot see. Do not add an opacity attribute to make
 * that testable: that is the shim modelling style, which is the line this file
 * exists not to cross.
 *
 * `onLoad` is never called — jsdom does not fetch, decode, or lay out anything.
 * A component that waits for it waits forever, so the screens must render the
 * image immediately and treat `onError` as the only signal worth handling.
 */
export const Image: ComponentType<{
  source?: { uri?: string } | number;
  style?: unknown;
  resizeMode?: string;
  testID?: string;
  pointerEvents?: string;
  onError?: () => void;
  onLoad?: () => void;
}> = ({ source, testID }) =>
  createElement('img', {
    src: typeof source === 'object' && source !== null ? source.uri : undefined,
    ...(testID ? { 'data-testid': testID } : {}),
    alt: '',
  });

/**
 * Keyboard handling has no meaning in jsdom, so this renders its children and
 * nothing else. What the real one does — lifting the pinned action clear of the
 * keyboard — is a layout behaviour, and layout is out of scope here (see the
 * note at the top of this file).
 */
export const KeyboardAvoidingView = box();

/**
 * Animation is style, and this shim does not model style — so `Animated.View`
 * is a plain box and the drivers are no-ops that report as finished. Tests here
 * assert what is on screen; whether it slid in belongs to a device.
 *
 * `start` invokes its callback synchronously so any code sequenced after an
 * animation still runs, rather than silently never happening.
 */
export const Animated = {
  View: box(),
  Text,
  Value: class AnimatedValue {
    current: number;
    constructor(initial: number) {
      this.current = initial;
    }
    setValue(next: number) {
      this.current = next;
    }
    interpolate() {
      return this;
    }
  },
  timing: (_value: unknown, _config: unknown) => ({
    start: (done?: (result: { finished: boolean }) => void) => done?.({ finished: true }),
  }),
  spring: (_value: unknown, _config: unknown) => ({
    start: (done?: (result: { finished: boolean }) => void) => done?.({ finished: true }),
  }),
};

export const Easing = {
  out: (fn: unknown) => fn,
  back: (_s?: number) => (t: number) => t,
  cubic: (t: number) => t,
};

/**
 * No keyboard exists in jsdom, so listeners are accepted and never fire — a
 * screen renders as though the keyboard were closed, which is the state its
 * assertions are written against.
 */
export const Keyboard = {
  addListener: (_event: string, _handler: (e: unknown) => void) => ({ remove: () => {} }),
};

/**
 * A portrait phone, fixed. jsdom has no viewport worth reporting and nothing
 * here rotates, so components that need to behave differently in landscape take
 * the orientation as a prop and let this be the default — see
 * `ViewfinderFrame`. Whether the real window is measured correctly on rotation
 * is a device question.
 */
export const useWindowDimensions = () => ({ width: 400, height: 800 });

/** Only ever read for `Platform.OS`; the shim stands in for a phone. */
export const Platform = { OS: 'android' as const, select: <T,>(o: { android?: T; default?: T }) => o.android ?? o.default };

/** Pressable maps to a button so Testing Library's click drives `onPress`. */
export const Pressable: ComponentType<Styled & { onPress?: () => void }> = ({ children, onPress }) =>
  createElement('button', { onClick: onPress, type: 'button' }, children);

/**
 * TextInput maps to an input. RN reports the new text directly, while the DOM
 * reports an event, so the change is unwrapped here to match RN's contract.
 */
export const TextInput: ComponentType<{
  value?: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  autoCapitalize?: 'none' | 'characters';
  style?: unknown;
}> = ({ value, onChangeText, placeholder, maxLength }) =>
  createElement('input', {
    value: value ?? '',
    placeholder,
    maxLength,
    onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
  });

export const StyleSheet = {
  create<T extends Record<string, unknown>>(styles: T): T {
    return styles;
  },
  /**
   * The real constant, not a stand-in — it is a plain style object in RN too.
   * Present because the camera preview and the onion-skin overlay are both
   * absolutely positioned over the whole frame; the value is inert here, since
   * styles are dropped, but the property has to exist for the import to work.
   */
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const,
};
