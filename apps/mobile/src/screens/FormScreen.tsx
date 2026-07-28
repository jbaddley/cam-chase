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
 * Dismissal on scroll is per-platform because the platforms genuinely differ.
 * iOS has an interactive dismiss, where the keyboard tracks the drag and can be
 * pulled back up — that is the native gesture and it feels like one. Android
 * has no equivalent and its apps simply keep the keyboard up while scrolling,
 * so it gets `none`. Using `on-drag` everywhere, as this did, snapped the
 * keyboard away mid-scroll on both: not the iOS gesture, and not Android
 * behaviour at all.
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
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
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
