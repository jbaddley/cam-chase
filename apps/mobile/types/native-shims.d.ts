/**
 * Minimal ambient shims so the scaffold typechecks before the Expo/React Native
 * toolchain is installed. Once you run the Expo install (see README.md), the
 * real package types supersede these.
 */
declare module 'react-native' {
  import type { ComponentType, ReactNode } from 'react';
  interface Styled {
    style?: unknown;
    children?: ReactNode;
  }
  export const View: ComponentType<Styled>;
  export const Text: ComponentType<Styled>;
  export const ScrollView: ComponentType<Styled>;
  export const Pressable: ComponentType<Styled & { onPress?: () => void }>;
  export const TextInput: ComponentType<{
    value?: string;
    onChangeText?: (text: string) => void;
    placeholder?: string;
    maxLength?: number;
    autoCapitalize?: 'none' | 'characters';
    style?: unknown;
  }>;
  export const StyleSheet: {
    create<T extends Record<string, unknown>>(styles: T): T;
  };
}
