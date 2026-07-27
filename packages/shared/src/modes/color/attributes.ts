/**
 * Colour Hunt attribute sets.
 *
 * Each team is secretly assigned an attribute, shoots photos that genuinely
 * contain it while obscuring which element is theirs, and the other teams then
 * study the set and guess.
 *
 * Only two specificity levels ship. The brainstorm that produced this mode
 * stacked colour + shape + placement + theme and concluded it was getting too
 * complex to play; a guess with four axes is one nobody commits to and a score
 * nobody can reason about. So: colour alone, or colour plus exactly one
 * modifier.
 */

import { mulberry32, shuffle } from '../../engine/rng.js';

export const COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'black',
  'white',
] as const;
export type Color = (typeof COLORS)[number];

/** Shape modifier — the visual half of the "plus one" level. */
export const SHAPES = ['round', 'square', 'striped', 'triangular', 'spiral'] as const;
export type Shape = (typeof SHAPES)[number];

/** Motif modifier — the "what is it made of / what is it" half. */
export const MOTIFS = ['metal', 'wooden', 'natural', 'man_made', 'edible'] as const;
export type Motif = (typeof MOTIFS)[number];

/** How hard the guess is. `color_plus` adds exactly one modifier, never two. */
export const COLOR_SPECIFICITIES = ['simple', 'color_plus'] as const;
export type ColorSpecificity = (typeof COLOR_SPECIFICITIES)[number];

/**
 * A team's secret. At most one of `shape`/`motif` is ever set — that is the
 * whole point of capping the level at "plus one".
 */
export interface AttributeSet {
  color: Color;
  shape?: Shape;
  motif?: Motif;
}

/** The individually-guessable parts of a set, for per-element scoring. */
export function attributeElements(set: AttributeSet): string[] {
  const elements: string[] = [set.color];
  if (set.shape) elements.push(set.shape);
  if (set.motif) elements.push(set.motif);
  return elements;
}

/** How many elements a set has, which is the most a guesser can score on it. */
export const elementCount = (set: AttributeSet): number => attributeElements(set).length;

/**
 * Assign one secret per team, deterministically from the game's seed.
 *
 * Colours are drawn without replacement so no two teams share one: two teams on
 * "red" makes a correct guess ambiguous to score and, worse, ambiguous to play.
 * With more teams than colours the pool wraps, which cannot happen at the
 * six-team cap but is handled rather than left to produce `undefined`.
 */
export function assignAttributeSets(input: {
  teamIds: readonly string[];
  specificity: ColorSpecificity;
  seed: number;
}): Record<string, AttributeSet> {
  const rng = mulberry32(input.seed);
  const colors = shuffle([...COLORS], rng);
  const modifiers = shuffle<Shape | Motif>([...SHAPES, ...MOTIFS], rng);

  const sets: Record<string, AttributeSet> = {};
  input.teamIds.forEach((teamId, i) => {
    const color = colors[i % colors.length]!;
    if (input.specificity === 'simple') {
      sets[teamId] = { color };
      return;
    }
    const modifier = modifiers[i % modifiers.length]!;
    sets[teamId] = isShape(modifier) ? { color, shape: modifier } : { color, motif: modifier };
  });
  return sets;
}

const SHAPE_SET: ReadonlySet<string> = new Set(SHAPES);
const isShape = (value: Shape | Motif): value is Shape => SHAPE_SET.has(value);

/** A guess one team commits about another's secret. */
export interface AttributeGuess {
  color?: Color;
  shape?: Shape;
  motif?: Motif;
}

/**
 * How many elements of `secret` the guess got right.
 *
 * Scored per element rather than all-or-nothing, so a partial read still pays —
 * a team that spotted the colour but misread the modifier learned something and
 * should bank it.
 */
export function correctElements(secret: AttributeSet, guess: AttributeGuess): number {
  let hits = 0;
  if (guess.color !== undefined && guess.color === secret.color) hits += 1;
  if (secret.shape !== undefined && guess.shape === secret.shape) hits += 1;
  if (secret.motif !== undefined && guess.motif === secret.motif) hits += 1;
  return hits;
}

/** A human-readable description, shown once the secrets are revealed. */
export function describeAttributeSet(set: AttributeSet): string {
  return attributeElements(set).join(' + ');
}
