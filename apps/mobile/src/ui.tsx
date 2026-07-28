import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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

/**
 * The standard screen frame: full height, the usual padding and gap, on the
 * app's surface colour. Every screen declared its own `container` style before
 * this and they had drifted into four different gaps.
 */
export function Screen({ children, scroll = false }: { children: ReactNode; scroll?: boolean }) {
  if (scroll) {
    return <ScrollView contentContainerStyle={styles.screenScroll}>{children}</ScrollView>;
  }
  return <View style={styles.screen}>{children}</View>;
}

/**
 * The "not here yet" state every screen that fetches something needs: its own
 * title, so the screen is recognisable while it loads, and one line saying
 * whether it is loading or has failed. Eleven screens had hand-rolled this.
 */
export function Loading({ title, message }: { title: ReactNode; message: ReactNode }) {
  return (
    <Screen>
      <Title>{title}</Title>
      <Body muted>{message}</Body>
    </Screen>
  );
}

/**
 * A tappable pill: a star, a foul, a team to vote for, an item to claim.
 *
 * Six screens had grown their own version of this — `optionPicked`,
 * `starPicked`, `teamPicked`, `foulCalled`, `itemFound` — in four paddings and
 * three radii. `tone` covers what those variants actually meant.
 */
export function Chip({
  children,
  onPress,
  selected = false,
  tone = 'neutral',
  disabled = false,
}: {
  children: ReactNode;
  onPress?: () => void;
  selected?: boolean;
  tone?: 'neutral' | 'positive' | 'danger' | 'highlight';
  disabled?: boolean;
}) {
  const style = disabled
    ? styles.chipDisabled
    : selected
      ? tone === 'danger'
        ? styles.chipDanger
        : tone === 'positive'
          ? styles.chipPositive
          : styles.chipSelected
      : tone === 'highlight'
        ? styles.chipHighlight
        : styles.chip;

  return (
    <Pressable onPress={disabled ? () => {} : (onPress ?? (() => {}))} style={style}>
      <Text style={disabled ? styles.chipTextMuted : styles.chipText}>{children}</Text>
    </Pressable>
  );
}

/**
 * A labelled row of choices.
 *
 * The label and the options are siblings inside one view on purpose: tests
 * find a row by its label and then look for options within its parent, and
 * several screens depend on that.
 */
export function ChoiceRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.choiceRow}>
      <Text style={styles.choiceLabel}>{label}</Text>
      <View style={styles.choices}>{children}</View>
    </View>
  );
}

/** A labelled text input, styled once. */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  maxLength,
  autoCapitalize,
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  autoCapitalize?: 'none' | 'characters';
}) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.choiceLabel}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        style={styles.input}
      />
    </View>
  );
}

/** A left/right row — a name against a count, a stat against its value. */
export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={styles.error}>{children}</Text>;
}

const chipBase = {
  paddingVertical: space.md,
  paddingHorizontal: space.lg,
  borderRadius: radius.md,
};

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

  screen: { flex: 1, padding: space.xl, gap: space.md, backgroundColor: color.surface },
  screenScroll: { padding: space.xl, gap: space.md, backgroundColor: color.surface, flexGrow: 1 },

  chip: { ...chipBase, backgroundColor: color.surfaceSunken },
  chipSelected: { ...chipBase, backgroundColor: color.primary },
  chipPositive: { ...chipBase, backgroundColor: color.positive },
  chipDanger: { ...chipBase, backgroundColor: color.dangerSurface },
  chipHighlight: { ...chipBase, backgroundColor: color.surfaceRaised, borderWidth: 2, borderColor: color.primary },
  chipDisabled: { ...chipBase, backgroundColor: color.surfaceSunken, opacity: 0.5 },
  chipText: { ...type.body, fontWeight: '600', color: color.ink },
  chipTextMuted: { ...type.body, fontWeight: '600', color: color.inkMuted },

  choiceRow: { paddingVertical: space.sm, gap: space.sm },
  choiceLabel: { ...type.label, color: color.inkMuted },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

  field: { paddingVertical: space.sm, gap: space.sm },
  input: {
    ...type.body,
    color: color.ink,
    backgroundColor: color.surfaceSunken,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
