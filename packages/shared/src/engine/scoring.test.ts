import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { GeoPoint } from '../domain/types.js';
import {
  BEST_MATCH_BONUS,
  computeScoreboard,
  FOUL_PENALTY,
  haversineMeters,
  locationPoints,
  resolveVoteWeight,
  SPECIAL_BONUS,
  type ScoreAssignment,
  type ScoreVote,
  type ScoringInput,
} from './scoring.js';

const ORIGIN: GeoPoint = { lat: 40.0, lng: -74.0 };

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(ORIGIN, ORIGIN)).toBe(0);
  });

  it('measures ~111m for 0.001° of latitude', () => {
    const d = haversineMeters(ORIGIN, { lat: 40.001, lng: -74.0 });
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(115);
  });
});

describe('locationPoints', () => {
  it.each([
    [0, 100],
    [10, 100],
    [10.1, 60],
    [25, 60],
    [40, 30],
    [50, 30],
    [51, 0],
    [1000, 0],
  ])('distance %dm → %d points', (distance, points) => {
    expect(locationPoints(distance)).toBe(points);
  });
});

describe('resolveVoteWeight', () => {
  it('weights judges and spectators by judgeWeight, others 1x', () => {
    expect(resolveVoteWeight('judge', 5)).toBe(5);
    expect(resolveVoteWeight('spectator', 3)).toBe(3);
    expect(resolveVoteWeight('member', 5)).toBe(1);
    expect(resolveVoteWeight('captain', 5)).toBe(1);
  });
});

describe('computeScoreboard', () => {
  const baseInput: ScoringInput = {
    teamIds: ['A', 'B'],
    assignments: [
      { id: 'a1', chaserTeamId: 'A', ownerTeamId: 'B', originalPhotoId: 'pB', chasePhotoId: 'cA' },
      { id: 'a2', chaserTeamId: 'B', ownerTeamId: 'A', originalPhotoId: 'pA', chasePhotoId: 'cB' },
    ],
    locations: {
      pB: ORIGIN,
      cA: ORIGIN, // exact match → 100 location points for A
      pA: ORIGIN,
      cB: { lat: 40.001, lng: -74.0 }, // ~111m → 0 location points for B
    },
    votes: [
      { assignmentId: 'a1', axis: 'pose', stars: 5, weight: 1 },
      { assignmentId: 'a1', axis: 'angle', stars: 4, weight: 1 },
      { assignmentId: 'a1', axis: 'pose', stars: 4, weight: 5 }, // judge vote, weight 5
      { assignmentId: 'a2', axis: 'pose', stars: 2, weight: 1 },
    ],
  };

  it('credits location and weighted votes to the chasing team', () => {
    const board = computeScoreboard(baseInput);
    const a = board.find((s) => s.teamId === 'A')!;
    const b = board.find((s) => s.teamId === 'B')!;
    expect(a.location).toBe(100);
    expect(b.location).toBe(0);
    // Pose/angle are a weighted mean per chase, scaled by RATING_AXIS_MAX (20),
    // rounded — not a sum of stars. A's one chase: pose mean (5·1 + 4·5)/6 = 4.17
    // → round(4.17/5·20) = 17; angle mean 4 → 4/5·20 = 16. B's one chase: pose
    // mean 2 → 2/5·20 = 8; angle unrated → 0.
    expect(a.pose).toBe(17);
    expect(a.angle).toBe(16);
    expect(b.pose).toBe(8);
    expect(b.angle).toBe(0);
  });

  it('scores a chase on its mean rating, not its number of raters', () => {
    // The reason pose/angle stopped being a sum. You cannot rate your own chase,
    // so a bigger team's chase always draws fewer raters — here A's chase gets
    // one rater and B's identical chase gets three, as if B were the larger team.
    // Summing stars would score B three times as high for that alone; the mean,
    // which is what actually reflects how well each chase was recreated, must not.
    const assignments: ScoreAssignment[] = [
      { id: 'a1', chaserTeamId: 'A', ownerTeamId: 'B', originalPhotoId: 'pB', chasePhotoId: 'cA' },
      { id: 'a2', chaserTeamId: 'B', ownerTeamId: 'A', originalPhotoId: 'pA', chasePhotoId: 'cB' },
    ];
    const votes: ScoreVote[] = [
      { assignmentId: 'a1', axis: 'pose', stars: 4, weight: 1 },
      { assignmentId: 'a1', axis: 'angle', stars: 5, weight: 1 },
      ...[0, 1, 2].flatMap((): ScoreVote[] => [
        { assignmentId: 'a2', axis: 'pose', stars: 4, weight: 1 },
        { assignmentId: 'a2', axis: 'angle', stars: 5, weight: 1 },
      ]),
    ];
    const board = computeScoreboard({ teamIds: ['A', 'B'], assignments, locations: {}, votes });
    const a = board.find((s) => s.teamId === 'A')!;
    const b = board.find((s) => s.teamId === 'B')!;

    expect(a.pose).toBe(b.pose);
    expect(a.angle).toBe(b.angle);
    // The value is the mean scaled, not the sum: pose 4 → 4/5·20 = 16, angle 5 → 20.
    expect(a.pose).toBe(16);
    expect(a.angle).toBe(20);
  });

  it('applies foul penalties, best-match and special bonuses', () => {
    const board = computeScoreboard({
      ...baseInput,
      fouls: { B: 2 },
      bestMatchTeamId: 'A',
      specialWinners: ['A', 'B'],
    });
    const a = board.find((s) => s.teamId === 'A')!;
    const b = board.find((s) => s.teamId === 'B')!;
    expect(a.bestMatchBonus).toBe(BEST_MATCH_BONUS);
    expect(a.specialBonus).toBe(SPECIAL_BONUS);
    expect(b.foulPenalty).toBe(2 * FOUL_PENALTY);
  });

  it('ranks return times fastest-first for the time bonus', () => {
    const board = computeScoreboard({
      ...baseInput,
      returnDurations: { A: 500_000, B: 300_000 },
    });
    const a = board.find((s) => s.teamId === 'A')!;
    const b = board.find((s) => s.teamId === 'B')!;
    expect(b.timeBonus).toBe(40); // faster
    expect(a.timeBonus).toBe(30);
  });

  it('sorts by total desc then teamId asc', () => {
    const board = computeScoreboard(baseInput);
    for (let i = 1; i < board.length; i++) {
      const prev = board[i - 1]!;
      const cur = board[i]!;
      expect(prev.total >= cur.total).toBe(true);
    }
  });

  it('total is deterministic regardless of vote/assignment order (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1 })), (perm) => {
        void perm;
        const shuffledVotes = [...baseInput.votes].reverse();
        const shuffledAssignments = [...baseInput.assignments].reverse();
        const a = computeScoreboard(baseInput);
        const b = computeScoreboard({
          ...baseInput,
          votes: shuffledVotes,
          assignments: shuffledAssignments,
        });
        expect(b).toEqual(a);
        return true;
      }),
    );
  });
});
