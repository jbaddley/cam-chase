import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

/**
 * A screen with text fields: scrolling content, and an action pinned below it
 * that the keyboard cannot hide.
 *
 * Three things here are the difference between usable and not, and all three
 * were missing:
 *
 * - `keyboardShouldPersistTaps` — without it the first tap anywhere is spent
 *   dismissing the keyboard, so choosing an option took two taps and looked
 *   like the first one had failed.
 * - `KeyboardAvoidingView` — the action sits below the scroll area, which the
 *   keyboard otherwise covers entirely.
 * - Bottom padding on the content — the last field would otherwise sit under
 *   the pinned action with no way to scroll it clear.
 *
 * Android relies on `adjustResize`, which Expo sets, so it needs no behavior of
 * its own; passing one there fights the system inset and jumps the layout.
 */
export function FormScreen({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {children}
      </ScrollView>
      {action ? <View style={styles.action}>{action}</View> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 24, paddingBottom: 16, gap: 8 },
  action: { paddingHorizontal: 24, paddingBottom: 16, paddingTop: 8, gap: 8 },
});
