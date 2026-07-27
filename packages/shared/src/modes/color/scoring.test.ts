import { describe, expect, it } from 'vitest';
import type { AttributeSet } from './attributes.js';
import { BLUFF_POINTS, ELEMENT_POINTS, scoreColorHunt, type ColorGuessRecord } from './scoring.js';

const SECRETS: Record<string, AttributeSet> = {
  a: { color: 'red', shape: 'round' },
  b: { color: 'blue', motif: 'metal' },
};

const guess = (guesserTeamId: string, subjectTeamId: string, g: ColorGuessRecord['guess']): ColorGuessRecord => ({
  guesserTeamId,
  subjectTeamId,
  guess: g,
});

function score(guesses: ColorGuessRecord[], extra: Partial<Parameters<typeof scoreColorHunt>[0]> = {}) {
  return scoreColorHunt({ teamIds: ['a', 'b'], secrets: SECRETS, guesses, ...extra });
}

const forTeam = (board: ReturnType<typeof score>, teamId: string) => board.find((s) => s.teamId === teamId)!;

describe('scoreColorHunt — reading', () => {
  it('pays each element guessed right', () => {
    const board = score([guess('a', 'b', { color: 'blue', motif: 'metal' })]);
    expect(forTeam(board, 'a').location).toBe(2 * ELEMENT_POINTS);
  });

  it('pays a partial read', () => {
    const board = score([guess('a', 'b', { color: 'blue', motif: 'wooden' })]);
    expect(forTeam(board, 'a').location).toBe(ELEMENT_POINTS);
  });

  it('pays nothing for a guess that got neither element', () => {
    const board = score([guess('a', 'b', { color: 'green', motif: 'wooden' })]);
    expect(forTeam(board, 'a').location).toBe(0);
  });

  it('counts a subject once per guesser, however many times it is submitted', () => {
    const board = score([
      guess('a', 'b', { color: 'blue', motif: 'metal' }),
      guess('a', 'b', { color: 'blue', motif: 'metal' }),
    ]);
    expect(forTeam(board, 'a').location).toBe(2 * ELEMENT_POINTS);
  });

  it('ignores a team guessing its own secret', () => {
    const board = score([guess('a', 'a', { color: 'red', shape: 'round' })]);
    expect(forTeam(board, 'a').location).toBe(0);
  });

  it('ignores a guess about a team with no secret', () => {
    const board = score([guess('a', 'ghost', { color: 'red' })]);
    expect(forTeam(board, 'a').location).toBe(0);
  });
});

describe('scoreColorHunt — bluffing', () => {
  it('pays the shooting team for every element a guesser got wrong', () => {
    const board = score([guess('a', 'b', { color: 'green', motif: 'wooden' })]);
    expect(forTeam(board, 'b').pose).toBe(2 * BLUFF_POINTS);
  });

  it('pays nothing to a team that was read perfectly', () => {
    const board = score([guess('a', 'b', { color: 'blue', motif: 'metal' })]);
    expect(forTeam(board, 'b').pose).toBe(0);
  });

  it('pays for a partial miss', () => {
    const board = score([guess('a', 'b', { color: 'blue', motif: 'wooden' })]);
    expect(forTeam(board, 'b').pose).toBe(BLUFF_POINTS);
  });

  it('treats an empty guess as a total miss, which it is', () => {
    const board = score([guess('a', 'b', {})]);
    expect(forTeam(board, 'b').pose).toBe(2 * BLUFF_POINTS);
  });

  it('pays nothing to a team whose attribute judges could not confirm', () => {
    // Otherwise the winning strategy is to leave the attribute out entirely,
    // which is unguessable — the bluff bonus only works with a real check.
    const board = score([guess('a', 'b', { color: 'green' })], { confirmed: { b: false } });
    expect(forTeam(board, 'b').pose).toBe(0);
  });

  it('still pays the guesser when the subject was not confirmed', () => {
    const board = score([guess('a', 'b', { color: 'blue', motif: 'metal' })], { confirmed: { b: false } });
    expect(forTeam(board, 'a').location).toBe(2 * ELEMENT_POINTS);
  });

  it('pays a team nobody judged, since most games have no moderator', () => {
    const board = score([guess('a', 'b', { color: 'green' })]);
    expect(forTeam(board, 'b').pose).toBeGreaterThan(0);
  });
});

describe('scoreColorHunt — board', () => {
  it('applies fouls and finals bonuses like every other mode', () => {
    const board = score([], { fouls: { a: 1 }, specialWinners: ['b'], bestMatchTeamId: 'b' });
    expect(forTeam(board, 'a').foulPenalty).toBeGreaterThan(0);
    expect(forTeam(board, 'b').specialBonus).toBeGreaterThan(0);
    expect(forTeam(board, 'b').bestMatchBonus).toBeGreaterThan(0);
  });

  it('never awards the angle or time columns, which this mode does not use', () => {
    const board = score([guess('a', 'b', { color: 'blue' }), guess('b', 'a', { color: 'red' })]);
    for (const s of board) {
      expect(s.angle).toBe(0);
      expect(s.timeBonus).toBe(0);
    }
  });

  it('totals consistently and ranks highest first', () => {
    const board = score([
      guess('a', 'b', { color: 'blue', motif: 'metal' }),
      guess('b', 'a', { color: 'green', shape: 'square' }),
    ]);
    for (const s of board) {
      expect(s.total).toBe(
        s.location + s.pose + s.angle + s.timeBonus + s.bestMatchBonus + s.specialBonus - s.foulPenalty,
      );
    }
    // a read b perfectly (40) and gave up no bluff; b read nothing but bluffed
    // a's two elements (20). Reading beats bluffing when it is this clean.
    expect(board[0]!.teamId).toBe('a');
  });

  it('lists every team even with no guesses at all', () => {
    expect(score([]).map((s) => s.teamId).sort()).toEqual(['a', 'b']);
  });
});
