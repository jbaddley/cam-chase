import { describe, expect, it } from 'vitest';
import { assignTagRoles, hunterCount, isHunterNearby, PROXIMITY_WARNING_M } from './roles.js';

const TEAMS = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('assignTagRoles — pure finder', () => {
  it('deals nothing per player, since everyone hunts one shared target', () => {
    expect(assignTagRoles({ teamIds: TEAMS, subMode: 'pure_finder', seed: 1 })).toEqual({});
  });
});

describe('assignTagRoles — hide and seek', () => {
  const deal = (teamIds = TEAMS, seed = 7) => assignTagRoles({ teamIds, subMode: 'hide_seek', seed }).roles!;

  it('is deterministic for a seed', () => {
    expect(deal()).toEqual(deal());
  });

  it('gives everyone a role', () => {
    expect(Object.keys(deal()).sort()).toEqual([...TEAMS].sort());
  });

  it('makes a minority hunt', () => {
    const roles = deal();
    const hunters = Object.values(roles).filter((r) => r === 'hunter').length;
    expect(hunters).toBe(hunterCount(TEAMS.length));
    expect(hunters).toBeLessThan(TEAMS.length / 2);
  });

  it('always has at least one hunter, however small the game', () => {
    // Two players with no hunter is not a game.
    const roles = assignTagRoles({ teamIds: ['a', 'b'], subMode: 'hide_seek', seed: 1 }).roles!;
    expect(Object.values(roles).filter((r) => r === 'hunter')).toHaveLength(1);
  });

  it('deals a different split for a different seed', () => {
    expect(deal(TEAMS, 1)).not.toEqual(deal(TEAMS, 2));
  });
});

describe('assignTagRoles — dual', () => {
  const deal = (teamIds = TEAMS, seed = 7) => assignTagRoles({ teamIds, subMode: 'dual', seed }).targets!;

  it('is deterministic for a seed', () => {
    expect(deal()).toEqual(deal());
  });

  it('gives everyone exactly one prey', () => {
    const targets = deal();
    expect(Object.keys(targets).sort()).toEqual([...TEAMS].sort());
  });

  it('makes everyone hunted by exactly one person', () => {
    const hunted = Object.values(deal());
    expect(new Set(hunted).size).toBe(TEAMS.length);
    expect([...hunted].sort()).toEqual([...TEAMS].sort());
  });

  it('never assigns a player to hunt themselves', () => {
    for (const [hunter, prey] of Object.entries(deal())) {
      expect(prey).not.toBe(hunter);
    }
  });

  it('is mutual with two players, which is inherent to a two-cycle', () => {
    // Worth pinning: dual only becomes an interesting game from three up.
    const targets = assignTagRoles({ teamIds: ['a', 'b'], subMode: 'dual', seed: 1 }).targets!;
    expect(targets.a).toBe('b');
    expect(targets.b).toBe('a');
  });

  it('leaves nobody without prey, however many play', () => {
    // A naive pairing can strand the last player; a single cycle cannot.
    for (const size of [2, 3, 4, 5, 6]) {
      const teamIds = TEAMS.slice(0, size);
      const targets = assignTagRoles({ teamIds, subMode: 'dual', seed: size }).targets!;
      expect(Object.keys(targets)).toHaveLength(size);
      expect(new Set(Object.values(targets)).size).toBe(size);
    }
  });
});

describe('isHunterNearby', () => {
  const here = { lat: 40, lng: -74 };
  /** Roughly 20 m north of `here`. */
  const close = { lat: 40.00018, lng: -74 };
  /** Roughly 500 m north of `here`. */
  const far = { lat: 40.0045, lng: -74 };

  it('warns when the hunter is inside the threshold', () => {
    expect(isHunterNearby(here, close)).toBe(true);
  });

  it('stays quiet when the hunter is well away', () => {
    expect(isHunterNearby(here, far)).toBe(false);
  });

  it('stays quiet when either side has no known position', () => {
    expect(isHunterNearby(here, undefined)).toBe(false);
    expect(isHunterNearby(undefined, close)).toBe(false);
  });

  it('is a boolean, never a distance or a name', () => {
    // Naming the hunter lets the prey simply avoid one person — the exploit the
    // brainstorm flagged. The signature is the guarantee.
    expect(typeof isHunterNearby(here, close)).toBe('boolean');
    expect(PROXIMITY_WARNING_M).toBeGreaterThan(0);
  });
});
