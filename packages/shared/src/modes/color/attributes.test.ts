import { describe, expect, it } from 'vitest';
import {
  assignAttributeSets,
  attributeElements,
  correctElements,
  describeAttributeSet,
  elementCount,
  COLORS,
  MOTIFS,
  SHAPES,
  type AttributeSet,
} from './attributes.js';

const TEAMS = ['a', 'b', 'c'];

describe('assignAttributeSets', () => {
  it('is deterministic for a seed', () => {
    const first = assignAttributeSets({ teamIds: TEAMS, specificity: 'simple', seed: 7 });
    const second = assignAttributeSets({ teamIds: TEAMS, specificity: 'simple', seed: 7 });
    expect(first).toEqual(second);
  });

  it('produces different secrets for a different seed', () => {
    const first = assignAttributeSets({ teamIds: TEAMS, specificity: 'simple', seed: 1 });
    const second = assignAttributeSets({ teamIds: TEAMS, specificity: 'simple', seed: 2 });
    expect(first).not.toEqual(second);
  });

  it('gives every team a secret', () => {
    const sets = assignAttributeSets({ teamIds: TEAMS, specificity: 'simple', seed: 3 });
    expect(Object.keys(sets).sort()).toEqual(['a', 'b', 'c']);
  });

  it('never gives two teams the same colour', () => {
    // Two teams on "red" makes a correct guess ambiguous to score and to play.
    const sets = assignAttributeSets({ teamIds: ['a', 'b', 'c', 'd', 'e', 'f'], specificity: 'simple', seed: 5 });
    const colors = Object.values(sets).map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('gives the simple level a colour and nothing else', () => {
    for (const set of Object.values(assignAttributeSets({ teamIds: TEAMS, specificity: 'simple', seed: 9 }))) {
      expect(COLORS).toContain(set.color);
      expect(set.shape).toBeUndefined();
      expect(set.motif).toBeUndefined();
    }
  });

  it('gives the plus level exactly one modifier, never both', () => {
    // Stacking modifiers is what the brainstorm itself called too complex.
    for (const set of Object.values(assignAttributeSets({ teamIds: TEAMS, specificity: 'color_plus', seed: 11 }))) {
      const modifiers = [set.shape, set.motif].filter((m) => m !== undefined);
      expect(modifiers).toHaveLength(1);
      expect([...SHAPES, ...MOTIFS]).toContain(modifiers[0]);
    }
  });

  it('handles more teams than colours rather than producing an undefined set', () => {
    const many = Array.from({ length: COLORS.length + 2 }, (_, i) => `t${i}`);
    const sets = assignAttributeSets({ teamIds: many, specificity: 'simple', seed: 1 });
    expect(Object.values(sets).every((s) => COLORS.includes(s.color))).toBe(true);
  });
});

describe('attributeElements', () => {
  it('lists the colour alone at the simple level', () => {
    expect(attributeElements({ color: 'red' })).toEqual(['red']);
    expect(elementCount({ color: 'red' })).toBe(1);
  });

  it('lists the modifier alongside the colour', () => {
    expect(attributeElements({ color: 'blue', shape: 'round' })).toEqual(['blue', 'round']);
    expect(elementCount({ color: 'blue', motif: 'metal' })).toBe(2);
  });
});

describe('correctElements', () => {
  const secret: AttributeSet = { color: 'red', shape: 'round' };

  it('pays a fully correct guess for every element', () => {
    expect(correctElements(secret, { color: 'red', shape: 'round' })).toBe(2);
  });

  it('pays a partial read, so spotting the colour alone still banks', () => {
    expect(correctElements(secret, { color: 'red', shape: 'square' })).toBe(1);
  });

  it('pays nothing for a guess that got neither element', () => {
    expect(correctElements(secret, { color: 'blue', shape: 'square' })).toBe(0);
  });

  it('pays nothing for elements left blank', () => {
    expect(correctElements(secret, {})).toBe(0);
  });

  it('ignores a modifier the secret does not have', () => {
    // Guessing "round" against a colour-only secret must not score.
    expect(correctElements({ color: 'red' }, { color: 'red', shape: 'round' })).toBe(1);
  });

  it('does not credit a motif guess against a shape secret', () => {
    expect(correctElements(secret, { color: 'red', motif: 'metal' })).toBe(1);
  });
});

describe('describeAttributeSet', () => {
  it('reads as the elements joined, for the reveal', () => {
    expect(describeAttributeSet({ color: 'red', shape: 'round' })).toBe('red + round');
    expect(describeAttributeSet({ color: 'green' })).toBe('green');
  });
});
