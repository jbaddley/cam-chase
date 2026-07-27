import { describe, expect, it } from 'vitest';
import type { TeamScore } from '../domain/types.js';
import {
  aggregateStandings,
  placementsFromScoreboard,
  tournamentTeamKey,
  type GamePlacement,
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

/** A placement as a league would record it, keyed by name. */
const at = (teamName: string, gamePoints: number): GamePlacement => ({
  teamKey: tournamentTeamKey(teamName),
  teamName,
  gamePoints,
});

describe('tournamentTeamKey', () => {
  it('ignores case and surrounding space', () => {
    expect(tournamentTeamKey('  The Reds ')).toBe(tournamentTeamKey('the reds'));
  });

  it('collapses runs of inner whitespace', () => {
    expect(tournamentTeamKey('The  Reds')).toBe(tournamentTeamKey('The Reds'));
  });

  it('keeps genuinely different names apart', () => {
    expect(tournamentTeamKey('The Reds')).not.toBe(tournamentTeamKey('The Blues'));
  });
});

describe('placementsFromScoreboard', () => {
  it('preserves best-first order and carries totals', () => {
    const board = [score('t1', 200), score('t2', 150)];
    expect(placementsFromScoreboard(board, { t1: 'Reds', t2: 'Blues' })).toEqual([
      { teamKey: 'reds', teamName: 'Reds', gamePoints: 200 },
      { teamKey: 'blues', teamName: 'Blues', gamePoints: 150 },
    ]);
  });

  it('keys on the team name, not the per-game team id', () => {
    // Team ids are minted per game. Keying on them would give every team a
    // single-game row and the table would never accumulate.
    const week1 = placementsFromScoreboard([score('team_aaa', 200)], { team_aaa: 'Reds' });
    const week2 = placementsFromScoreboard([score('team_zzz', 180)], { team_zzz: 'Reds' });
    expect(week1[0]!.teamKey).toBe(week2[0]!.teamKey);
  });

  it('falls back to the id when a name is missing, rather than dropping the team', () => {
    expect(placementsFromScoreboard([score('t1', 10)], {})[0]!.teamKey).toBe('t1');
  });
});

describe('aggregateStandings', () => {
  it('accumulates placement points, wins, and game points across games', () => {
    const results: GameResult[] = [
      { gameId: 'g1', placements: [at('A', 200), at('B', 150), at('C', 100)] },
      { gameId: 'g2', placements: [at('B', 180), at('A', 170), at('C', 120)] },
    ];
    const standings = aggregateStandings(results);
    const find = (name: string) => standings.find((s) => s.teamKey === tournamentTeamKey(name))!;

    expect(find('A').placementPoints).toBe(10 + 6); // 1st + 2nd
    expect(find('B').placementPoints).toBe(6 + 10);
    expect(find('A').wins).toBe(1);
    expect(find('B').wins).toBe(1);
    expect(find('C').gamesPlayed).toBe(2);
    expect(find('A').totalGamePoints).toBe(370);
  });

  it('accumulates a team across games however its ids differ', () => {
    const week1 = placementsFromScoreboard([score('team_1', 200), score('team_2', 100)], {
      team_1: 'Reds',
      team_2: 'Blues',
    });
    const week2 = placementsFromScoreboard([score('team_9', 210), score('team_8', 110)], {
      team_9: 'Reds',
      team_8: 'Blues',
    });
    const standings = aggregateStandings([
      { gameId: 'g1', placements: week1 },
      { gameId: 'g2', placements: week2 },
    ]);

    expect(standings).toHaveLength(2);
    expect(standings[0]!.teamName).toBe('Reds');
    expect(standings[0]!.gamesPlayed).toBe(2);
    expect(standings[0]!.wins).toBe(2);
  });

  it('shows the most recent spelling a team played under', () => {
    const standings = aggregateStandings([
      { gameId: 'g1', placements: [at('the reds', 200)] },
      { gameId: 'g2', placements: [at('The Reds', 200)] },
    ]);
    expect(standings).toHaveLength(1);
    expect(standings[0]!.teamName).toBe('The Reds');
  });

  it('breaks ties on placement points by total game points', () => {
    const results: GameResult[] = [
      { gameId: 'g1', placements: [at('A', 300), at('B', 100)] },
      { gameId: 'g2', placements: [at('B', 300), at('A', 100)] },
    ];
    // Equal placement points (10+6 each) and equal game points, so the key
    // breaks the tie — deterministic rather than insertion-ordered.
    const standings = aggregateStandings(results);
    expect(standings[0]!.placementPoints).toBe(standings[1]!.placementPoints);
    expect(standings[0]!.teamKey).toBe('a');
  });

  it('ranks the more consistent team higher', () => {
    const results: GameResult[] = [
      { gameId: 'g1', placements: [at('A', 200), at('B', 190)] },
      { gameId: 'g2', placements: [at('A', 200), at('B', 190)] },
    ];
    const standings = aggregateStandings(results);
    expect(standings[0]!.teamKey).toBe('a');
    expect(standings[0]!.wins).toBe(2);
  });

  it('returns an empty table for a season nobody has played yet', () => {
    expect(aggregateStandings([])).toEqual([]);
  });
});
