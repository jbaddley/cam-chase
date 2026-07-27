import { describe, expect, it } from 'vitest';
import type { TeamScore } from '../../domain/types.js';
import { placementsFromScoreboard } from '../../tournament/standings.js';
import { applyCatchUp, catchUpMultiplier, combineLegs, MAX_CATCH_UP_MULTIPLIER, type GauntletLeg } from './combine.js';

function score(teamId: string, overrides: Partial<TeamScore> = {}): TeamScore {
  const base = {
    teamId,
    location: 0,
    pose: 0,
    angle: 0,
    timeBonus: 0,
    bestMatchBonus: 0,
    specialBonus: 0,
    foulPenalty: 0,
    ...overrides,
  };
  return {
    ...base,
    total:
      base.location + base.pose + base.angle + base.timeBonus + base.bestMatchBonus + base.specialBonus - base.foulPenalty,
  };
}

/** A leg where team ids are minted fresh, as the real handlers do. */
const leg = (prefix: string, totals: Record<string, number>): GauntletLeg =>
  placementsFromScoreboard(
    Object.entries(totals).map(([name, value]) => score(`${prefix}_${name}`, { location: value })),
    Object.fromEntries(Object.keys(totals).map((name) => [`${prefix}_${name}`, name])),
  );

describe('combineLegs', () => {
  it('sums a team across legs despite per-game team ids', () => {
    // The same reason league standings key on the name: ids are per game.
    const table = combineLegs([leg('g1', { Reds: 100, Blues: 60 }), leg('g2', { Reds: 40, Blues: 80 })]);
    const reds = table.find((s) => s.teamKey === 'reds')!;
    expect(reds.total).toBe(140);
    expect(reds.legsPlayed).toBe(2);
    expect(reds.legTotals).toEqual([100, 40]);
  });

  it('ranks by combined total, not by the last leg', () => {
    // Blues win leg 2 outright and still finish second on aggregate.
    const table = combineLegs([leg('g1', { Reds: 100, Blues: 60 }), leg('g2', { Reds: 40, Blues: 70 })]);
    expect(table.map((s) => s.teamKey)).toEqual(['reds', 'blues']);
  });

  it('leaves a zero for a leg a team missed, so columns stay aligned', () => {
    const table = combineLegs([leg('g1', { Reds: 100 }), leg('g2', { Reds: 40, Blues: 80 })]);
    expect(table.find((s) => s.teamKey === 'blues')!.legTotals).toEqual([0, 80]);
  });

  it('breaks a dead tie deterministically', () => {
    const table = combineLegs([leg('g1', { Reds: 50, Blues: 50 })]);
    expect(table.map((s) => s.teamKey)).toEqual(['blues', 'reds']);
  });

  it('shows the most recent spelling of a name', () => {
    const table = combineLegs([leg('g1', { 'the reds': 10 }), leg('g2', { 'The Reds': 10 })]);
    expect(table).toHaveLength(1);
    expect(table[0]!.teamName).toBe('The Reds');
  });

  it('returns an empty table for a gauntlet nobody has played', () => {
    expect(combineLegs([])).toEqual([]);
  });
});

describe('catchUpMultiplier', () => {
  it('gives the leader no boost', () => {
    expect(catchUpMultiplier(100, 100)).toBe(1);
  });

  it('gives a team on nothing the largest boost', () => {
    expect(catchUpMultiplier(0, 100)).toBe(MAX_CATCH_UP_MULTIPLIER);
  });

  it('scales with the gap rather than stepping', () => {
    // A step function would reward tanking a leg to drop into a lower band.
    const half = catchUpMultiplier(50, 100);
    expect(half).toBeGreaterThan(1);
    expect(half).toBeLessThan(MAX_CATCH_UP_MULTIPLIER);
    expect(catchUpMultiplier(25, 100)).toBeGreaterThan(half);
  });

  it('never boosts someone ahead of the leader', () => {
    expect(catchUpMultiplier(150, 100)).toBe(1);
  });

  it('does nothing when nobody has scored yet', () => {
    expect(catchUpMultiplier(0, 0)).toBe(1);
  });

  it('stays small enough that the first leg still matters', () => {
    // A handicap should keep a blowout worth playing, not hand the game over.
    expect(MAX_CATCH_UP_MULTIPLIER).toBeLessThanOrEqual(1.5);
  });
});

describe('applyCatchUp', () => {
  const before = combineLegs([leg('g1', { Reds: 100, Blues: 0 })]);
  const names = { t_reds: 'Reds', t_blues: 'Blues' };

  it('leaves the leader untouched', () => {
    const finalLeg = [score('t_reds', { location: 100 })];
    expect(applyCatchUp(finalLeg, before, names)[0]).toBe(finalLeg[0]);
  });

  it('boosts the trailing team’s final leg', () => {
    const [boosted] = applyCatchUp([score('t_blues', { location: 100 })], before, names);
    expect(boosted!.location).toBe(Math.round(100 * MAX_CATCH_UP_MULTIPLIER));
  });

  it('keeps the breakdown adding up to the total a player sees', () => {
    const finalLeg = [score('t_blues', { location: 80, pose: 30, foulPenalty: 10 })];
    const [boosted] = applyCatchUp(finalLeg, before, names);
    expect(boosted!.total).toBe(
      boosted!.location + boosted!.pose + boosted!.angle + boosted!.timeBonus + boosted!.bestMatchBonus + boosted!.specialBonus - boosted!.foulPenalty,
    );
  });

  it('scales the foul penalty too, so a handicap is not also an amnesty', () => {
    const [boosted] = applyCatchUp([score('t_blues', { location: 100, foulPenalty: 20 })], before, names);
    expect(boosted!.foulPenalty).toBeGreaterThan(20);
  });

  it('cannot flip a lead the handicap was not meant to overturn', () => {
    // Reds lead by 100 and match Blues in the final leg; the boost narrows the
    // gap without erasing it.
    const finalLeg = [score('t_reds', { location: 100 }), score('t_blues', { location: 100 })];
    const after = combineLegs([
      leg('g1', { Reds: 100, Blues: 0 }),
      placementsFromScoreboard(applyCatchUp(finalLeg, before, names), names),
    ]);
    expect(after[0]!.teamKey).toBe('reds');
  });
});
