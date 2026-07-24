import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TeamScore } from '../domain/types.js';
import { simulateGame, type SimSpec } from './harness.js';

describe('simulateGame — full lifecycle', () => {
  it('drives a game to the results state', () => {
    const result = simulateGame({
      numTeams: 3,
      membersPerTeam: 2,
      photosPerRound: 5,
      gameType: 'round_robin',
      seed: 42,
    });
    expect(result.finalState).toBe('results');
    expect(result.scoreboard).toHaveLength(3);
  });
});

describe('simulateGame — hand-computed scoreboard', () => {
  // 2 teams, 1 member each, no judges, 1 photo/round, round robin, exact chases.
  // T0 chases T1's photo (exact → 100 loc); voter is T1's member (1x):
  //   pose 5, angle 4. T0 is faster (rank 0 → +40) and wins best match (+50).
  // T1 chases T0's photo (exact → 100 loc); voter is T0's member:
  //   pose 4, angle 3. rank 1 → +30.
  it('matches an independently computed scoreboard exactly', () => {
    const result = simulateGame({
      numTeams: 2,
      membersPerTeam: 1,
      photosPerRound: 1,
      gameType: 'round_robin',
      seed: 1,
    });

    const expected: TeamScore[] = [
      {
        teamId: 'T0',
        location: 100,
        pose: 5,
        angle: 4,
        timeBonus: 40,
        bestMatchBonus: 50,
        specialBonus: 0,
        foulPenalty: 0,
        total: 199,
      },
      {
        teamId: 'T1',
        location: 100,
        pose: 4,
        angle: 3,
        timeBonus: 30,
        bestMatchBonus: 0,
        specialBonus: 0,
        foulPenalty: 0,
        total: 137,
      },
    ];
    expect(result.scoreboard).toEqual(expected);
  });
});

describe('simulateGame — determinism & invariants (property-based)', () => {
  const spec = fc.record({
    numTeams: fc.integer({ min: 2, max: 6 }),
    membersPerTeam: fc.integer({ min: 1, max: 4 }),
    photosPerRound: fc.integer({ min: 1, max: 8 }),
    gameType: fc.constantFrom('round_robin' as const, 'random' as const),
    seed: fc.integer({ min: 0, max: 2 ** 31 }),
    judges: fc.integer({ min: 0, max: 3 }),
    judgeWeight: fc.integer({ min: 1, max: 5 }),
  });

  it('is fully reproducible for a fixed spec', () => {
    fc.assert(
      fc.property(spec, (s: SimSpec) => {
        expect(simulateGame(s).scoreboard).toEqual(simulateGame(s).scoreboard);
        return true;
      }),
    );
  });

  it('always reaches results with one score per team, sorted by total', () => {
    fc.assert(
      fc.property(spec, (s: SimSpec) => {
        const { finalState, scoreboard } = simulateGame(s);
        expect(finalState).toBe('results');
        expect(scoreboard).toHaveLength(s.numTeams);
        for (let i = 1; i < scoreboard.length; i++) {
          expect(scoreboard[i - 1]!.total >= scoreboard[i]!.total).toBe(true);
        }
        return true;
      }),
    );
  });
});
