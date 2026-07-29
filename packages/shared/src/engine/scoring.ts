import type { RatingAxis, Role } from '../domain/enums.js';
import type { GeoPoint, TeamScore } from '../domain/types.js';

/** Points awarded by GPS proximity of a chase photo to its original. */
export const LOCATION_BANDS: ReadonlyArray<{ maxM: number; points: number }> = [
  { maxM: 10, points: 100 },
  { maxM: 25, points: 60 },
  { maxM: 50, points: 30 },
];
export const FOUL_PENALTY = 25;
export const TIME_BONUS_BY_RANK: readonly number[] = [40, 30, 20, 10, 0, 0];
export const BEST_MATCH_BONUS = 50;
export const SPECIAL_BONUS = 15;

/** Ratings run 1–5 stars (see the product spec and `ScoreVote.stars`). */
export const MAX_STARS = 5;
/**
 * Most a single chase can earn on pose, and the same again on angle. These are
 * the recreation-quality axes; location accuracy (up to 100 per chase) stays the
 * dominant one, so each of these sits a clear step below it.
 */
export const RATING_AXIS_MAX = 20;

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in meters. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Map a distance to location points using the bands above. */
export function locationPoints(distanceM: number): number {
  for (const band of LOCATION_BANDS) {
    if (distanceM <= band.maxM) return band.points;
  }
  return 0;
}

/** Judge/spectator votes count at the configured multiplier; others at 1x. */
export function resolveVoteWeight(role: Role, judgeWeight: number): number {
  return role === 'judge' || role === 'spectator' ? judgeWeight : 1;
}

export interface ScoreAssignment {
  id: string;
  chaserTeamId: string;
  ownerTeamId: string;
  originalPhotoId: string;
  chasePhotoId: string | null;
}

export interface ScoreVote {
  assignmentId: string;
  axis: RatingAxis;
  stars: number;
  /** Pre-resolved weight (see resolveVoteWeight). */
  weight: number;
}

/** A fresh zeroed score row per team, keyed by id. Shared by every mode. */
export function emptyScores(teamIds: readonly string[]): Map<string, TeamScore> {
  return new Map(teamIds.map((id) => [id, emptyScore(id)]));
}

/** Fouls penalize the team whose photo was called. Shared by every mode. */
export function applyFouls(scores: Map<string, TeamScore>, fouls?: Record<string, number>): void {
  for (const [teamId, count] of Object.entries(fouls ?? {})) {
    const score = scores.get(teamId);
    if (score) score.foulPenalty += count * FOUL_PENALTY;
  }
}

/**
 * Return-time bonus by rank, faster first. Teams with no recorded duration are
 * absent from the map and simply place last, rather than scoring as instant.
 */
export function applyReturnBonus(
  scores: Map<string, TeamScore>,
  returnDurations?: Record<string, number>,
): void {
  const ranked = Object.entries(returnDurations ?? {})
    .filter(([teamId]) => scores.has(teamId))
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  ranked.forEach(([teamId], rank) => {
    const score = scores.get(teamId)!;
    score.timeBonus += TIME_BONUS_BY_RANK[rank] ?? 0;
  });
}

/** Finals outcomes: best-overall and one bonus per special category won. */
export function applyFinalsBonuses(
  scores: Map<string, TeamScore>,
  bestMatchTeamId?: string,
  specialWinners?: readonly string[],
): void {
  if (bestMatchTeamId) {
    const score = scores.get(bestMatchTeamId);
    if (score) score.bestMatchBonus += BEST_MATCH_BONUS;
  }
  for (const teamId of specialWinners ?? []) {
    const score = scores.get(teamId);
    if (score) score.specialBonus += SPECIAL_BONUS;
  }
}

/** Sum each row and return the scoreboard, highest total first. */
export function totalise(scores: Map<string, TeamScore>): TeamScore[] {
  for (const score of scores.values()) {
    score.total =
      score.location +
      score.pose +
      score.angle +
      score.timeBonus +
      score.bestMatchBonus +
      score.specialBonus -
      score.foulPenalty;
  }
  return [...scores.values()].sort((a, b) => b.total - a.total || a.teamId.localeCompare(b.teamId));
}

export interface ScoringInput {
  teamIds: string[];
  assignments: ScoreAssignment[];
  /** Photo id → capture location, for both originals and chase photos. */
  locations: Record<string, GeoPoint>;
  votes: ScoreVote[];
  /** teamId → number of fouls on that team's original photos. */
  fouls?: Record<string, number>;
  /** teamId → total return duration (ms); lower is faster. */
  returnDurations?: Record<string, number>;
  /** Finals: team that won best-overall-match. */
  bestMatchTeamId?: string;
  /** Finals: one teamId per special category won (repeats allowed). */
  specialWinners?: string[];
}

/** A running weighted tally of star ratings for one chase on one axis. */
interface WeightedStars {
  /** Σ stars×weight. */
  stars: number;
  /** Σ weight. */
  weight: number;
}

/**
 * One chase's points on a single axis: its weighted-mean star rating as a
 * fraction of a perfect score, times {@link RATING_AXIS_MAX}, rounded so the
 * results breakdown stays whole. Zero when nobody rated that axis.
 */
function axisPoints({ stars, weight }: WeightedStars): number {
  if (weight === 0) return 0;
  return Math.round((stars / weight / MAX_STARS) * RATING_AXIS_MAX);
}

function emptyScore(teamId: string): TeamScore {
  return {
    teamId,
    location: 0,
    pose: 0,
    angle: 0,
    timeBonus: 0,
    bestMatchBonus: 0,
    specialBonus: 0,
    foulPenalty: 0,
    total: 0,
  };
}

/**
 * Compute the full per-team scoreboard. Pure and deterministic; results are
 * sorted by total descending, then teamId ascending for stable tie-breaking.
 */
export function computeScoreboard(input: ScoringInput): TeamScore[] {
  const scores = emptyScores(input.teamIds);

  // Location + pose/angle votes, credited to the chasing team.
  for (const a of input.assignments) {
    const score = scores.get(a.chaserTeamId);
    if (!score) continue;
    if (a.chasePhotoId) {
      const orig = input.locations[a.originalPhotoId];
      const chase = input.locations[a.chasePhotoId];
      if (orig && chase) {
        score.location += locationPoints(haversineMeters(orig, chase));
      }
    }
  }
  // Pose and angle are a weighted mean per chase scaled to points — not a
  // running sum of stars. A chase is rated by everyone not on the chasing team
  // (see the sim harness), so a bigger team's chase draws fewer raters; summing
  // stars quietly scored it lower for its size, and skewed the finals bonuses it
  // could win on head-count alone. A mean depends on *how* a chase was rated, not
  // *how many* rated it — mirroring the weighted mean the scavenger and colour
  // scorers already use.
  const assignmentToChaser = new Map(input.assignments.map((a) => [a.id, a.chaserTeamId]));
  const tallies = new Map<string, { pose: WeightedStars; angle: WeightedStars }>();
  for (const v of input.votes) {
    if (!assignmentToChaser.has(v.assignmentId)) continue;
    let tally = tallies.get(v.assignmentId);
    if (!tally) {
      tally = { pose: { stars: 0, weight: 0 }, angle: { stars: 0, weight: 0 } };
      tallies.set(v.assignmentId, tally);
    }
    const axis = v.axis === 'pose' ? tally.pose : tally.angle;
    axis.stars += v.stars * v.weight;
    axis.weight += v.weight;
  }
  for (const [assignmentId, tally] of tallies) {
    const score = scores.get(assignmentToChaser.get(assignmentId)!);
    if (!score) continue;
    score.pose += axisPoints(tally.pose);
    score.angle += axisPoints(tally.angle);
  }

  applyFouls(scores, input.fouls);
  applyReturnBonus(scores, input.returnDurations);
  applyFinalsBonuses(scores, input.bestMatchTeamId, input.specialWinners);
  return totalise(scores);
}
