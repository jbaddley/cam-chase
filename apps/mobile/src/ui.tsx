import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
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
      // A tap should be felt, not just obeyed. Pressable already tracks the
      // press, so this needs no animation driver and cannot get out of sync
      // with the touch.
      style={({ pressed }) => [
        disabled ? styles.buttonDisabled : styles[tone],
        pressed && !disabled ? styles.pressed : null,
      ]}
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
  const { width, height } = useWindowDimensions();
  // Turned sideways, a form or list stretched the full width runs to very long
  // lines and buttons; cap it to a readable column, centred. Upright it fills.
  const wide = width > height;
  if (scroll) {
    // The cap has to sit on a *child* of the scroll container: alignSelf on the
    // contentContainer itself does not centre it. Upright, no wrapper.
    return (
      <ScrollView contentContainerStyle={styles.screenScroll}>
        {wide ? <View style={styles.screenReadable}>{children}</View> : children}
      </ScrollView>
    );
  }
  return <View style={[styles.screen, wide && styles.screenReadable]}>{children}</View>;
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
 * A round icon button for the header — the options gear, and anything like it.
 *
 * Header-sized rather than `Button`-sized because it sits in chrome, not in the
 * action zone. It still meets the 48 dp minimum target (docs/10): the glyph is
 * small, the hit area is not.
 */
export function IconButton({
  glyph,
  onPress,
  accessibilityLabel,
  testID,
}: {
  glyph: string;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Text style={styles.iconGlyph}>{glyph}</Text>
    </Pressable>
  );
}

/**
 * A modal sheet for controls that are set occasionally and then left alone.
 *
 * The convention it exists to serve (docs/10): options like view modes and
 * opacity do not belong on screen while they are being ignored, and they do not
 * belong on top of the picture. They belong behind a header affordance, in a sheet
 * with an explicit Done.
 *
 * Rises from the bottom because that is where a thumb is, and dismisses on the
 * backdrop as well as the button — a sheet you can only leave by finding the right
 * control is a trap on a phone.
 */
export function Sheet({
  visible,
  title,
  onClose,
  doneLabel,
  dismissLabel,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  doneLabel: string;
  /**
   * Names the tap-away area. Distinct from `doneLabel` on purpose: two controls
   * with the same name are ambiguous to a screen reader reading them out, not just
   * to a test looking for one.
   */
  dismissLabel: string;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        {/* Tapping away closes it. Explicit rather than relying on the button. */}
        <Pressable style={styles.sheetDismissArea} onPress={onClose} accessibilityLabel={dismissLabel} />
        <View style={styles.sheet} testID="sheet">
          <Heading>{title}</Heading>
          {children}
          <Button onPress={onClose}>{doneLabel}</Button>
        </View>
      </View>
    </Modal>
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
    <Pressable
      onPress={disabled ? () => {} : (onPress ?? (() => {}))}
      style={({ pressed }) => [style, pressed && !disabled ? styles.pressed : null]}
    >
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

/** A labelled text input, styled once. `error` shows inline beneath it. */
export function Field({
  label,
  value,
  onChangeText,
  onBlur,
  placeholder,
  maxLength,
  autoCapitalize,
  error,
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  maxLength?: number;
  autoCapitalize?: 'none' | 'characters';
  /** A validation message shown beneath the input, and it reddens the border. */
  error?: string;
}) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.choiceLabel}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        style={[styles.input, error ? styles.inputError : null]}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

/**
 * Pops its children in on mount: a small overshoot, settling.
 *
 * For the one thing on a screen that is the point of the screen — the winner.
 * Used on more than that it stops meaning anything, which is why it is a
 * component you have to reach for rather than something `Card` does.
 */
export function Pop({ children, delayMs = 0 }: { children: ReactNode; delayMs?: number }) {
  const scale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.timing(scale, {
      toValue: 1,
      duration: 420,
      delay: delayMs,
      // `back` overshoots and comes back, which is what makes it read as a pop
      // rather than a zoom.
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: true,
    }).start();
  }, [scale, delayMs]);

  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
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

  /**
   * What a press looks like: pushed down and slightly dimmed. Scale rather than
   * only opacity, because the chunky look reads as physical and a flat fade
   * does not.
   */
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },

  screen: { flex: 1, padding: space.xl, gap: space.md, backgroundColor: color.surface },
  screenScroll: { padding: space.xl, gap: space.md, backgroundColor: color.surface, flexGrow: 1 },
  /** Landscape: a readable column instead of full-bleed lines the width of a
      tablet. Centred, so the two gutters are even. `gap` so the wrapped scroll
      content keeps the spacing the contentContainer gives it upright. */
  screenReadable: { maxWidth: 680, width: '100%', alignSelf: 'center', gap: space.md },

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
  inputError: { borderColor: color.danger },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  /** 48 dp minimum target, per docs/10 — the glyph is small, the hit area is not. */
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: color.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: { fontSize: 20, color: color.inkMuted },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheetDismissArea: { flex: 1 },
  sheet: {
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.xl,
    paddingBottom: space.xxl,
    gap: space.md,
  },
});
