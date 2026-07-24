import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planAssignments, type TeamPhotos } from './assignment.js';

function makeTeams(numTeams: number, photosPerTeam: number): TeamPhotos[] {
  return Array.from({ length: numTeams }, (_, t) => ({
    teamId: `T${t}`,
    photoIds: Array.from({ length: photosPerTeam }, (_, p) => `T${t}-P${p}`),
  }));
}

describe('planAssignments — round robin', () => {
  it('gives each team the next team’s photos in original order', () => {
    const teams = makeTeams(3, 4);
    const plans = planAssignments(teams, 'round_robin', 1);
    const t0 = plans.filter((p) => p.chaserTeamId === 'T0');
    expect(t0.map((p) => p.originalPhotoId)).toEqual(['T1-P0', 'T1-P1', 'T1-P2', 'T1-P3']);
    expect(t0.map((p) => p.order)).toEqual([0, 1, 2, 3]);
    // The last team chases the first.
    const t2 = plans.filter((p) => p.chaserTeamId === 'T2');
    expect(t2.every((p) => p.ownerTeamId === 'T0')).toBe(true);
  });
});

describe('planAssignments — invariants (property-based)', () => {
  const scenario = fc.record({
    numTeams: fc.integer({ min: 2, max: 6 }),
    photosPerTeam: fc.integer({ min: 5, max: 20 }),
    gameType: fc.constantFrom('round_robin' as const, 'random' as const),
    seed: fc.integer({ min: 0, max: 2 ** 31 }),
  });

  it('never assigns a team its own photo', () => {
    fc.assert(
      fc.property(scenario, ({ numTeams, photosPerTeam, gameType, seed }) => {
        const teams = makeTeams(numTeams, photosPerTeam);
        const plans = planAssignments(teams, gameType, seed);
        return plans.every((p) => p.chaserTeamId !== p.ownerTeamId);
      }),
    );
  });

  it('chases every original photo exactly once', () => {
    fc.assert(
      fc.property(scenario, ({ numTeams, photosPerTeam, gameType, seed }) => {
        const teams = makeTeams(numTeams, photosPerTeam);
        const plans = planAssignments(teams, gameType, seed);
        const allPhotos = teams.flatMap((t) => t.photoIds).sort();
        const chased = plans.map((p) => p.originalPhotoId).sort();
        expect(chased).toEqual(allPhotos);
        return true;
      }),
    );
  });

  it('is reproducible for a fixed seed', () => {
    fc.assert(
      fc.property(scenario, ({ numTeams, photosPerTeam, gameType, seed }) => {
        const teams = makeTeams(numTeams, photosPerTeam);
        const a = planAssignments(teams, gameType, seed);
        const b = planAssignments(teams, gameType, seed);
        expect(a).toEqual(b);
        return true;
      }),
    );
  });

  it('keeps each chasing team’s queue orders contiguous from 0', () => {
    fc.assert(
      fc.property(scenario, ({ numTeams, photosPerTeam, gameType, seed }) => {
        const teams = makeTeams(numTeams, photosPerTeam);
        const plans = planAssignments(teams, gameType, seed);
        for (const t of teams) {
          const orders = plans
            .filter((p) => p.chaserTeamId === t.teamId)
            .map((p) => p.order)
            .sort((x, y) => x - y);
          orders.forEach((o, i) => expect(o).toBe(i));
        }
        return true;
      }),
    );
  });
});
