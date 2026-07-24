import { describe, expect, it } from 'vitest';
import { resolveVoteWeight } from './scoring.js';
import { computeScoreboard } from './scoring.js';
import {
  BEST_OVERALL_CATEGORY,
  resolveFinals,
  tallyCategoryWinners,
  type FinalsVote,
} from './finals.js';

describe('tallyCategoryWinners', () => {
  it('picks the highest weighted team per category', () => {
    const votes: FinalsVote[] = [
      { category: 'craziest_pose', teamId: 'A', weight: 1 },
      { category: 'craziest_pose', teamId: 'A', weight: 1 },
      { category: 'craziest_pose', teamId: 'B', weight: 1 },
      { category: 'worst_attempt', teamId: 'B', weight: 1 },
    ];
    expect(tallyCategoryWinners(votes)).toEqual({ craziest_pose: 'A', worst_attempt: 'B' });
  });

  it('applies judge weighting to swing a category', () => {
    const votes: FinalsVote[] = [
      { category: 'craziest_pose', teamId: 'A', weight: 1 },
      { category: 'craziest_pose', teamId: 'A', weight: 1 },
      // one judge at 5x outweighs two members
      { category: 'craziest_pose', teamId: 'B', weight: resolveVoteWeight('judge', 5) },
    ];
    expect(tallyCategoryWinners(votes)).toEqual({ craziest_pose: 'B' });
  });

  it('breaks ties by teamId ascending', () => {
    const votes: FinalsVote[] = [
      { category: 'best_photobomb', teamId: 'B', weight: 2 },
      { category: 'best_photobomb', teamId: 'A', weight: 2 },
    ];
    expect(tallyCategoryWinners(votes)).toEqual({ best_photobomb: 'A' });
  });
});

describe('resolveFinals', () => {
  it('separates best-overall-match from special categories', () => {
    const votes: FinalsVote[] = [
      { category: BEST_OVERALL_CATEGORY, teamId: 'A', weight: 3 },
      { category: 'craziest_pose', teamId: 'B', weight: 1 },
      { category: 'worst_attempt', teamId: 'B', weight: 1 },
    ];
    const outcome = resolveFinals(votes);
    expect(outcome.bestMatchTeamId).toBe('A');
    expect(outcome.specialWinners).toEqual(['B', 'B']);
  });

  it('feeds bonuses into the scoreboard', () => {
    const outcome = resolveFinals([
      { category: BEST_OVERALL_CATEGORY, teamId: 'A', weight: 1 },
      { category: 'craziest_pose', teamId: 'A', weight: 1 },
    ]);
    const board = computeScoreboard({
      teamIds: ['A', 'B'],
      assignments: [],
      locations: {},
      votes: [],
      bestMatchTeamId: outcome.bestMatchTeamId,
      specialWinners: outcome.specialWinners,
    });
    const a = board.find((s) => s.teamId === 'A')!;
    expect(a.bestMatchBonus).toBeGreaterThan(0);
    expect(a.specialBonus).toBeGreaterThan(0);
  });
});
