import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, radius, shadow, space, type } from './theme.js';

/**
 * The handful of components every screen is built from.
 *
 * They exist so that "a button" means one thing across the app. Before this
 * each screen declared its own yellow rectangle, and they had drifted into
 * three different paddings and two different radii.
 *
 * Each takes children rather than a `title` string, so a caller can put a
 * count, an icon or a spinner inside without a new prop appearing here.
 */

export type ButtonTone = 'primary' | 'secondary' | 'danger';

export function Button({
  onPress,
  children,
  tone = 'primary',
  disabled = false,
  accessibilityLabel,
}: {
  onPress: () => void;
  children: ReactNode;
  tone?: ButtonTone;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={disabled ? () => {} : onPress}
      style={disabled ? styles.buttonDisabled : styles[tone]}
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={disabled ? styles.buttonTextDisabled : tone === 'secondary' ? styles.buttonTextQuiet : styles.buttonText}>
        {children}
      </Text>
    </Pressable>
  );
}

/** A raised panel. `tone="highlight"` is the winner, the code, the payoff. */
export function Card({
  children,
  tone = 'plain',
}: {
  children: ReactNode;
  tone?: 'plain' | 'highlight';
}) {
  return <View style={tone === 'highlight' ? styles.cardHighlight : styles.card}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Display({ children }: { children: ReactNode }) {
  return <Text style={styles.display}>{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={muted ? styles.bodyMuted : styles.body}>{children}</Text>;
}

/** A small rounded chip: a phase, a plan, a count. */
export function Pill({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'positive' }) {
  return (
    <View style={tone === 'positive' ? styles.pillPositive : styles.pill}>
      <Text style={styles.pillText}>{children}</Text>
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={styles.error}>{children}</Text>;
}

const buttonBase = {
  paddingVertical: space.lg,
  paddingHorizontal: space.xl,
  borderRadius: radius.lg,
  alignItems: 'center' as const,
};

const styles = StyleSheet.create({
  primary: { ...buttonBase, backgroundColor: color.primary, ...shadow },
  secondary: { ...buttonBase, backgroundColor: color.surfaceSunken },
  danger: { ...buttonBase, backgroundColor: color.dangerSurface },
  buttonDisabled: { ...buttonBase, backgroundColor: color.surfaceSunken },
  buttonText: { ...type.heading, color: color.ink },
  buttonTextQuiet: { ...type.body, fontWeight: '600', color: color.inkMuted },
  buttonTextDisabled: { ...type.heading, color: color.border },

  card: {
    backgroundColor: color.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.lg,
    gap: space.xs,
  },
  cardHighlight: {
    backgroundColor: color.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: color.primary,
    padding: space.lg,
    gap: space.xs,
    ...shadow,
  },

  display: { ...type.display, color: color.ink, letterSpacing: 2 },
  title: { ...type.title, color: color.ink },
  heading: { ...type.heading, color: color.ink },
  body: { ...type.body, color: color.ink },
  bodyMuted: { ...type.body, color: color.inkMuted },

  pill: {
    alignSelf: 'flex-start',
    backgroundColor: color.accent,
    borderRadius: radius.pill,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
  pillPositive: {
    alignSelf: 'flex-start',
    backgroundColor: color.positive,
    borderRadius: radius.pill,
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
  pillText: { ...type.label, color: color.surface },

  error: { ...type.body, color: color.danger },
});
