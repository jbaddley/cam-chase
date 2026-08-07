import { describe, expect, it } from 'vitest';
import { resolveVoteWeight } from './scoring.js';
import { computeScoreboard } from './scoring.js';
import {
  BEST_OVERALL_CATEGORY,
  pickFinalists,
  resolveFinals,
  tallyCategoryWinners,
  type FinalsVote,
} from './finals.js';
import type { Assignment, Vote } from '../domain/types.js';

const asn = (id: string, team: string, order: number, chase: string | null): Assignment => ({
  id,
  gameId: 'g',
  chaserTeamId: team,
  originalPhotoId: `o_${id}`,
  order,
  chasePhotoId: chase,
});
const star = (assignmentId: string, stars: number): Vote => ({
  id: `v_${assignmentId}_${stars}`,
  gameId: 'g',
  assignmentId,
  voterUserId: 'u',
  axis: 'pose',
  stars,
});

describe('pickFinalists', () => {
  it('shows each team its best-rated matchup, not just its first', () => {
    const assignments = [asn('a1', 'A', 0, 'c1'), asn('a2', 'A', 1, 'c2'), asn('b1', 'B', 0, 'c3')];
    // a2 out-stars a1, so A's finalist is the later, better-rated one.
    const votes = [star('a1', 3), star('a2', 5), star('b1', 4)];
    expect(pickFinalists(assignments, votes)).toEqual([
      { teamId: 'A', originalPhotoId: 'o_a2', chasePhotoId: 'c2' },
      { teamId: 'B', originalPhotoId: 'o_b1', chasePhotoId: 'c3' },
    ]);
  });

  it('falls back to the earliest matchup when a game is unrated or tied', () => {
    const assignments = [asn('a2', 'A', 1, 'c2'), asn('a1', 'A', 0, 'c1')];
    expect(pickFinalists(assignments, [])).toEqual([
      { teamId: 'A', originalPhotoId: 'o_a1', chasePhotoId: 'c1' },
    ]);
  });

  it('omits a team that submitted nothing to vote on', () => {
    const assignments = [asn('a1', 'A', 0, 'c1'), asn('b1', 'B', 0, null)];
    expect(pickFinalists(assignments, []).map((f) => f.teamId)).toEqual(['A']);
  });
});

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
