/**
 * The design tokens every screen draws from.
 *
 * PhotoChase is a party game played standing up, outdoors, passing a phone
 * around — so the type is large, the targets are big, and the colour is loud
 * enough to read in daylight. The screens before this were grey text on white
 * with one yellow button: legible, and completely joyless.
 *
 * Values live here rather than in each screen so a change to the palette is one
 * edit, and so two screens cannot drift into two different yellows.
 */

export const color = {
  /** The brand yellow. Primary actions, the winner, anything celebratory. */
  primary: '#ffd43b',
  primaryDark: '#f08c00',
  /** Deep ink for type; not pure black, which reads harsh at large sizes. */
  ink: '#212529',
  inkMuted: '#6c757d',
  /** Screen and card surfaces. */
  surface: '#ffffff',
  surfaceSunken: '#f8f9fa',
  surfaceRaised: '#fff9db',
  /** The secondary accent, for phases and live state. */
  accent: '#4c6ef5',
  positive: '#2f9e44',
  /** Used for one thing: the Photo Tag proximity warning. */
  warning: '#e8590c',
  danger: '#e03131',
  dangerSurface: '#ffe3e3',
  border: '#dee2e6',
  /** Podium tints, first through third. */
  podium: ['#ffd43b', '#ced4da', '#e8a87c'] as const,
} as const;

/** A 4-point spacing scale; every gap and pad is one of these. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;

/**
 * A deliberately short type scale. `display` is for the one thing a screen is
 * about — the code, the winner — and is meant to be readable at arm's length.
 */
export const type = {
  display: { fontSize: 44, fontWeight: '800' },
  title: { fontSize: 30, fontWeight: '800' },
  heading: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 17, fontWeight: '400' },
  label: { fontSize: 14, fontWeight: '600' },
} as const;

/**
 * A flat offset shadow rather than a soft blur: it survives Android's elevation
 * model, and the hard edge suits the chunky look.
 */
export const shadow = {
  shadowColor: color.ink,
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.12,
  shadowRadius: 0,
  elevation: 3,
} as const;
