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
}

const box =
  (role?: string): ComponentType<Styled> =>
  ({ children }) =>
    createElement('div', role ? { 'data-testid': role } : {}, children);

export const View = box();
/**
 * Scrolling itself is out of scope, but two props decide whether a screen with
 * a keyboard is usable at all, so they are surfaced as attributes for tests to
 * assert on. `keyboardShouldPersistTaps` in particular: without it the first
 * tap anywhere is spent dismissing the keyboard.
 */
export const ScrollView: ComponentType<
  Styled & { keyboardShouldPersistTaps?: string; contentContainerStyle?: unknown }
> = ({ children, keyboardShouldPersistTaps }) =>
  createElement(
    'div',
    { 'data-testid': 'scrollview', 'data-persist-taps': keyboardShouldPersistTaps ?? 'never' },
    children,
  );

export const Text: ComponentType<Styled> = ({ children }) => createElement('span', {}, children);

/**
 * Keyboard handling has no meaning in jsdom, so this renders its children and
 * nothing else. What the real one does — lifting the pinned action clear of the
 * keyboard — is a layout behaviour, and layout is out of scope here (see the
 * note at the top of this file).
 */
export const KeyboardAvoidingView = box();

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
};
