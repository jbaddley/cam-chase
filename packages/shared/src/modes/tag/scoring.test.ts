import { describe, expect, it } from 'vitest';
import {
  CATCH_POINTS,
  COUNTER_POINTS,
  SURVIVAL_POINTS,
  scoreTag,
  type CatchRecord,
  type TagScoringInput,
} from './scoring.js';

let nextId = 0;
const claim = (
  hunterTeamId: string,
  targetTeamId: string,
  overrides: Partial<CatchRecord> = {},
): CatchRecord => ({
  id: `c${nextId++}`,
  hunterTeamId,
  targetTeamId,
  photoId: 'p1',
  claimedAt: 1000,
  status: 'confirmed',
  ...overrides,
});

function score(catches: CatchRecord[], extra: Partial<TagScoringInput> = {}) {
  return scoreTag({ teamIds: ['a', 'b', 'c'], subMode: 'pure_finder', catches, ...extra });
}

const forTeam = (board: ReturnType<typeof score>, teamId: string) => board.find((s) => s.teamId === teamId)!;

describe('scoreTag — confirmation', () => {
  it('pays a confirmed catch', () => {
    expect(forTeam(score([claim('a', 'b')]), 'a').location).toBe(CATCH_POINTS);
  });

  it('pays nothing for a claim the target has not answered', () => {
    // Nothing can verify identity from pixels, so an unanswered claim is not a
    // catch — it is an assertion.
    expect(forTeam(score([claim('a', 'b', { status: 'pending' })]), 'a').location).toBe(0);
  });

  it('pays nothing for a disputed claim', () => {
    expect(forTeam(score([claim('a', 'b', { status: 'disputed' })]), 'a').location).toBe(0);
  });

  it('pays nothing for a claim the host overruled', () => {
    expect(forTeam(score([claim('a', 'b', { status: 'overruled' })]), 'a').location).toBe(0);
  });

  it('counts a target once per hunter, however many times they are caught', () => {
    const board = score([claim('a', 'b', { claimedAt: 1 }), claim('a', 'b', { claimedAt: 2 })]);
    expect(forTeam(board, 'a').location).toBe(CATCH_POINTS);
  });

  it('lets two hunters both score the same target', () => {
    const board = score([claim('a', 'c'), claim('b', 'c')]);
    expect(forTeam(board, 'a').location).toBe(CATCH_POINTS);
    expect(forTeam(board, 'b').location).toBe(CATCH_POINTS);
  });
});

describe('scoreTag — survival', () => {
  it('pays a team nobody caught', () => {
    const board = score([claim('a', 'b')]);
    expect(forTeam(board, 'c').pose).toBe(SURVIVAL_POINTS);
    expect(forTeam(board, 'b').pose).toBe(0);
  });

  it('pays everyone when no catch was ever confirmed', () => {
    const board = score([claim('a', 'b', { status: 'pending' })]);
    for (const s of board) expect(s.pose).toBe(SURVIVAL_POINTS);
  });

  it('still pays a hunter who was never caught themselves', () => {
    const board = score([claim('a', 'b')]);
    expect(forTeam(board, 'a').location).toBe(CATCH_POINTS);
    expect(forTeam(board, 'a').pose).toBe(SURVIVAL_POINTS);
  });
});

describe('scoreTag — hide and seek', () => {
  const roles = { a: 'hunter', b: 'hider', c: 'hider' } as const;
  const hideSeek = (catches: CatchRecord[]) => score(catches, { subMode: 'hide_seek', roles });

  it('pays a hunter who caught a hider', () => {
    expect(forTeam(hideSeek([claim('a', 'b')]), 'a').location).toBe(CATCH_POINTS);
  });

  it('blocks the score when the hider photographed their hunter first', () => {
    // The counter is what makes a hider more than someone running away.
    const board = hideSeek([claim('b', 'a', { claimedAt: 100 }), claim('a', 'b', { claimedAt: 200 })]);
    expect(forTeam(board, 'a').location).toBe(0);
    expect(forTeam(board, 'b').pose).toBeGreaterThanOrEqual(COUNTER_POINTS);
  });

  it('does not block when the hunter got there first', () => {
    const board = hideSeek([claim('a', 'b', { claimedAt: 100 }), claim('b', 'a', { claimedAt: 200 })]);
    expect(forTeam(board, 'a').location).toBe(CATCH_POINTS);
  });

  it('ignores a hider photographing another hider', () => {
    expect(forTeam(hideSeek([claim('b', 'c')]), 'b').location).toBe(0);
  });

  it('breaks a same-millisecond tie by submission order, not by luck', () => {
    // Two claims can land in the same millisecond, and "who got there first"
    // would otherwise depend on nothing at all.
    const countered = hideSeek([
      claim('b', 'a', { claimedAt: 500 }),
      claim('a', 'b', { claimedAt: 500 }),
    ]);
    expect(forTeam(countered, 'a').location).toBe(0);

    const notCountered = hideSeek([
      claim('a', 'b', { claimedAt: 500 }),
      claim('b', 'a', { claimedAt: 500 }),
    ]);
    expect(forTeam(notCountered, 'a').location).toBe(CATCH_POINTS);
  });
});

describe('scoreTag — dual', () => {
  const targets = { a: 'b', b: 'c', c: 'a' };
  const dual = (catches: CatchRecord[]) => score(catches, { subMode: 'dual', targets });

  it('pays a catch of your own assigned prey', () => {
    expect(forTeam(dual([claim('a', 'b')]), 'a').location).toBe(CATCH_POINTS);
  });

  it('pays nothing for catching someone who is not your prey', () => {
    // The mode is your own chase, not opportunism.
    expect(forTeam(dual([claim('a', 'c')]), 'a').location).toBe(0);
  });

  it('does not mark a team caught by an unscored catch', () => {
    expect(forTeam(dual([claim('a', 'c')]), 'c').pose).toBe(SURVIVAL_POINTS);
  });
});

describe('scoreTag — board', () => {
  it('applies fouls and finals bonuses like every other mode', () => {
    const board = score([], { fouls: { a: 1 }, specialWinners: ['b'], bestMatchTeamId: 'b' });
    expect(forTeam(board, 'a').foulPenalty).toBeGreaterThan(0);
    expect(forTeam(board, 'b').specialBonus).toBeGreaterThan(0);
    expect(forTeam(board, 'b').bestMatchBonus).toBeGreaterThan(0);
  });

  it('never awards the angle or time columns, which this mode does not use', () => {
    for (const s of score([claim('a', 'b')])) {
      expect(s.angle).toBe(0);
      expect(s.timeBonus).toBe(0);
    }
  });

  it('totals consistently and ranks highest first', () => {
    const board = score([claim('a', 'b'), claim('a', 'c')]);
    for (const s of board) {
      expect(s.total).toBe(
        s.location + s.pose + s.angle + s.timeBonus + s.bestMatchBonus + s.specialBonus - s.foulPenalty,
      );
    }
    expect(board[0]!.teamId).toBe('a');
  });

  it('lists every team even with no catches at all', () => {
    expect(score([]).map((s) => s.teamId).sort()).toEqual(['a', 'b', 'c']);
  });
});
