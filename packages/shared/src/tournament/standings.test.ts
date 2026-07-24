import { describe, expect, it } from 'vitest';
import type { TeamScore } from '../domain/types.js';
import {
  aggregateStandings,
  placementsFromScoreboard,
  type GameResult,
} from './standings.js';

function score(teamId: string, total: number): TeamScore {
  return {
    teamId,
    location: 0,
    pose: 0,
    angle: 0,
    timeBonus: 0,
    bestMatchBonus: 0,
    specialBonus: 0,
    foulPenalty: 0,
    total,
  };
}

describe('placementsFromScoreboard', () => {
  it('preserves best-first order and carries totals', () => {
    const board = [score('A', 200), score('B', 150)];
    expect(placementsFromScoreboard(board)).toEqual([
      { teamKey: 'A', gamePoints: 200 },
      { teamKey: 'B', gamePoints: 150 },
    ]);
  });
});

describe('aggregateStandings', () => {
  it('accumulates placement points, wins, and game points across games', () => {
    const results: GameResult[] = [
      { gameId: 'g1', placements: [{ teamKey: 'A', gamePoints: 200 }, { teamKey: 'B', gamePoints: 150 }, { teamKey: 'C', gamePoints: 100 }] },
      { gameId: 'g2', placements: [{ teamKey: 'B', gamePoints: 180 }, { teamKey: 'A', gamePoints: 170 }, { teamKey: 'C', gamePoints: 120 }] },
    ];
    const standings = aggregateStandings(results);
    const a = standings.find((s) => s.teamKey === 'A')!;
    const b = standings.find((s) => s.teamKey === 'B')!;
    const c = standings.find((s) => s.teamKey === 'C')!;

    expect(a.placementPoints).toBe(10 + 6); // 1st + 2nd
    expect(b.placementPoints).toBe(6 + 10);
    expect(a.wins).toBe(1);
    expect(b.wins).toBe(1);
    expect(c.gamesPlayed).toBe(2);
    expect(a.totalGamePoints).toBe(370);
  });

  it('breaks ties on placement points by total game points', () => {
    const results: GameResult[] = [
      { gameId: 'g1', placements: [{ teamKey: 'A', gamePoints: 300 }, { teamKey: 'B', gamePoints: 100 }] },
      { gameId: 'g2', placements: [{ teamKey: 'B', gamePoints: 300 }, { teamKey: 'A', gamePoints: 100 }] },
    ];
    // Equal placement points (10+6 each); tie broken by total game points (equal here) then teamKey.
    const standings = aggregateStandings(results);
    expect(standings[0]!.placementPoints).toBe(standings[1]!.placementPoints);
    expect(standings[0]!.teamKey).toBe('A'); // teamKey tiebreak
  });

  it('ranks the more consistent team higher', () => {
    const results: GameResult[] = [
      { gameId: 'g1', placements: [{ teamKey: 'A', gamePoints: 200 }, { teamKey: 'B', gamePoints: 190 }] },
      { gameId: 'g2', placements: [{ teamKey: 'A', gamePoints: 200 }, { teamKey: 'B', gamePoints: 190 }] },
    ];
    const standings = aggregateStandings(results);
    expect(standings[0]!.teamKey).toBe('A');
    expect(standings[0]!.wins).toBe(2);
  });
});
