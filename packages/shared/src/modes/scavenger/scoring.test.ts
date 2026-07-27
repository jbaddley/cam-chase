import { describe, expect, it } from 'vitest';
import { ITEM_POINTS, WILDCARD_MULTIPLIER, type HuntItem } from './items.js';
import { resolveHuntFinds, scoreScavenger, VALIDITY_THRESHOLD, type HuntClaim, type HuntFind } from './scoring.js';

const ITEMS: HuntItem[] = [
  { id: 'leaf', label: 'A leaf', rarity: 'common' },
  { id: 'bird', label: 'A bird', rarity: 'rare' },
  { id: 'sock', label: 'An odd sock', rarity: 'common' },
];

const find = (teamId: string, itemId: string, valid = true): HuntFind => ({ teamId, itemId, valid });

function score(finds: HuntFind[], extra: Partial<Parameters<typeof scoreScavenger>[0]> = {}) {
  return scoreScavenger({ teamIds: ['a', 'b'], items: ITEMS, finds, ...extra });
}

const forTeam = (board: ReturnType<typeof score>, teamId: string) =>
  board.find((s) => s.teamId === teamId)!;

describe('scoreScavenger', () => {
  it('pays a validated common find', () => {
    expect(forTeam(score([find('a', 'leaf')]), 'a').location).toBe(ITEM_POINTS.common);
  });

  it('pays more for a rare find', () => {
    const board = score([find('a', 'leaf'), find('b', 'bird')]);
    expect(forTeam(board, 'b').location).toBeGreaterThan(forTeam(board, 'a').location);
    expect(forTeam(board, 'b').location).toBe(ITEM_POINTS.rare);
  });

  it('pays nothing for a find judges rejected', () => {
    // An unvalidated claim scores zero, but is not a foul — a wrong guess is
    // not cheating, and penalising it would discourage trying.
    const board = score([find('a', 'leaf', false)]);
    expect(forTeam(board, 'a').location).toBe(0);
    expect(forTeam(board, 'a').foulPenalty).toBe(0);
  });

  it('counts an item once per team, however many photos are submitted', () => {
    const board = score([find('a', 'leaf'), find('a', 'leaf'), find('a', 'leaf')]);
    expect(forTeam(board, 'a').location).toBe(ITEM_POINTS.common);
  });

  it('lets two teams both score the same item', () => {
    const board = score([find('a', 'leaf'), find('b', 'leaf')]);
    expect(forTeam(board, 'a').location).toBe(ITEM_POINTS.common);
    expect(forTeam(board, 'b').location).toBe(ITEM_POINTS.common);
  });

  it('ignores a claim against an item not on this hunt', () => {
    expect(forTeam(score([find('a', 'not_on_list')]), 'a').location).toBe(0);
  });

  it('doubles the wildcard', () => {
    const board = score([find('a', 'sock')], { wildcardItemId: 'sock' });
    expect(forTeam(board, 'a').location).toBe(ITEM_POINTS.common * WILDCARD_MULTIPLIER);
  });

  it('gives the faster returning team the larger time bonus', () => {
    const board = score([], { returnDurations: { a: 60_000, b: 300_000 } });
    expect(forTeam(board, 'a').timeBonus).toBeGreaterThan(forTeam(board, 'b').timeBonus);
  });

  it('applies fouls and special bonuses like every other mode', () => {
    const board = score([find('a', 'leaf')], { fouls: { a: 1 }, specialWinners: ['b'] });
    expect(forTeam(board, 'a').foulPenalty).toBeGreaterThan(0);
    expect(forTeam(board, 'b').specialBonus).toBeGreaterThan(0);
  });

  it('totals consistently and ranks highest first', () => {
    const board = score([find('b', 'bird'), find('a', 'leaf')]);
    for (const s of board) {
      expect(s.total).toBe(
        s.location + s.pose + s.angle + s.timeBonus + s.bestMatchBonus + s.specialBonus - s.foulPenalty,
      );
    }
    expect(board[0]!.teamId).toBe('b');
  });

  it('lists every team even with no finds at all', () => {
    const board = score([]);
    expect(board.map((s) => s.teamId).sort()).toEqual(['a', 'b']);
  });
});

describe('resolveHuntFinds', () => {
  const claim = (overrides: Partial<HuntClaim> = {}): HuntClaim => ({
    teamId: 'a',
    itemId: 'leaf',
    validityVotes: [],
    disputed: false,
    ...overrides,
  });

  it('counts an unjudged claim, so a game with no judges still scores', () => {
    expect(resolveHuntFinds([claim()])[0]!.valid).toBe(true);
  });

  it('counts a claim the votes accepted', () => {
    const votes = [{ stars: VALIDITY_THRESHOLD, weight: 1 }];
    expect(resolveHuntFinds([claim({ validityVotes: votes })])[0]!.valid).toBe(true);
  });

  it('rejects a claim the votes turned down', () => {
    const votes = [{ stars: 1, weight: 1 }, { stars: 2, weight: 1 }];
    expect(resolveHuntFinds([claim({ validityVotes: votes })])[0]!.valid).toBe(false);
  });

  it('lets a heavier judge vote outweigh a light one', () => {
    const votes = [{ stars: 5, weight: 1 }, { stars: 1, weight: 4 }];
    expect(resolveHuntFinds([claim({ validityVotes: votes })])[0]!.valid).toBe(false);
  });

  it('rejects a disputed claim however well it was rated', () => {
    const votes = [{ stars: 5, weight: 3 }];
    expect(resolveHuntFinds([claim({ validityVotes: votes, disputed: true })])[0]!.valid).toBe(false);
  });

  it('carries team and item through untouched', () => {
    const [find] = resolveHuntFinds([claim({ teamId: 'b', itemId: 'bird' })]);
    expect(find).toEqual({ teamId: 'b', itemId: 'bird', valid: true });
  });
});
