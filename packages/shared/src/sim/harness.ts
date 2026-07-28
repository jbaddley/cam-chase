import type { GameConfig } from '../config/schema.js';
import type { GameType } from '../domain/enums.js';
import type { GeoPoint, TeamScore } from '../domain/types.js';
import { planAssignments, type TeamPhotos } from '../engine/assignment.js';
import {
  computeScoreboard,
  resolveVoteWeight,
  type ScoreAssignment,
  type ScoreVote,
  type ScoringInput,
} from '../engine/scoring.js';
import { applyTransition, type Game } from '../engine/state.js';

/** Deterministic description of a game to simulate. */
export interface SimSpec {
  numTeams: number;
  membersPerTeam: number;
  photosPerRound: number;
  gameType: GameType;
  seed: number;
  judges?: number;
  judgeWeight?: number;
}

export interface SimResult {
  finalState: Game['state'];
  scoreboard: TeamScore[];
  scoringInput: ScoringInput;
}

const clampStar = (n: number): number => Math.max(1, Math.min(5, n));
/** Bots produce deterministic ratings: earlier-indexed teams shoot "better". */
const poseStars = (teamIndex: number): number => clampStar(5 - teamIndex);
const angleStars = (teamIndex: number): number => clampStar(4 - teamIndex);

function teamId(i: number): string {
  return `T${i}`;
}

function photoLocation(teamIndex: number, photoIndex: number): GeoPoint {
  return { lat: 40 + teamIndex, lng: -74 + photoIndex * 0.0001 };
}

/**
 * Walk every team back to the start point.
 *
 * Completing a return is gated on all teams having checked in, and the host may
 * force past it — but forcing here would mean the flagship simulation stopped
 * exercising the gate, which is the opposite of what a simulation is for. So the
 * bots do what real teams do.
 *
 * Times are the team index, so the run stays deterministic. They only reach the
 * scoreboard if `roundStartedAt` is stamped, which the harness does not do — the
 * time bonus stays out of the hand-computed comparison, as it always has.
 */
function checkEveryoneIn(game: Game, round: 'round1' | 'round2'): void {
  game.teams.forEach((team, i) => {
    const captain = game.memberships.find((m) => m.teamId === team.id);
    if (captain) captain.returnCheckins[round] = i;
  });
}

/**
 * Play a complete game end-to-end through the real engine: walk the lifecycle
 * state machine, capture Round 1 photos, plan Round 2 assignments, submit chase
 * photos, cast member/judge votes, and score the results. Fully deterministic
 * for a given spec — the flagship simulation from docs/05-testing-strategy.md.
 */
export function simulateGame(spec: SimSpec): SimResult {
  const judges = spec.judges ?? 0;
  const judgeWeight = spec.judgeWeight ?? 1;

  const config = {
    photosPerRound: spec.photosPerRound,
    round1Minutes: 15,
    round2Minutes: 15,
    maxTeams: spec.numTeams,
    gameType: spec.gameType,
    judgeWeight,
    specialCategories: { presets: [], custom: [] },
    geofencing: false,
    aiJudging: false,
    mode: 'photo_chase',
  } satisfies GameConfig;

  let game: Game = {
    id: 'sim',
    hostUserId: 'host',
    code: 'SIM000',
    tier: 'unlimited',
    config,
    state: 'draft',
    teams: [],
    memberships: [],
    photos: [],
    assignments: [],
    votes: [],
    createdAt: 0,
  };

  game = applyTransition(game, { type: 'OPEN_LOBBY' });

  // Teams, members, judges join the lobby.
  const teams: TeamPhotos[] = [];
  for (let i = 0; i < spec.numTeams; i++) {
    const id = teamId(i);
    game.teams.push({ id, gameId: game.id, name: id, createdAt: 0 });
    const photoIds: string[] = [];
    for (let m = 0; m < spec.membersPerTeam; m++) {
      game.memberships.push({
        id: `${id}-m${m}`,
        gameId: game.id,
        userId: `${id}-u${m}`,
        teamId: id,
        role: m === 0 ? 'captain' : 'member',
        returnCheckins: {},
      });
    }
    teams.push({ teamId: id, photoIds });
  }
  for (let j = 0; j < judges; j++) {
    game.memberships.push({
      id: `judge-${j}`,
      gameId: game.id,
      userId: `judge-u${j}`,
      teamId: null,
      role: 'judge',
      returnCheckins: {},
    });
  }

  game = applyTransition(game, { type: 'START_GAME' });

  // Round 1: each team captures its photos.
  const locations: Record<string, GeoPoint> = {};
  game.teams.forEach((team, i) => {
    for (let p = 0; p < spec.photosPerRound; p++) {
      const photoId = `${team.id}-P${p}`;
      const loc = photoLocation(i, p);
      locations[photoId] = loc;
      game.photos.push({
        id: photoId,
        gameId: game.id,
        teamId: team.id,
        shooterUserId: `${team.id}-u${p % spec.membersPerTeam}`,
        order: p,
        location: loc,
        capturedAt: p,
        s3Key: `photos/${photoId}.jpg`,
        fouls: [],
      });
      teams[i]!.photoIds.push(photoId);
    }
  });

  game = applyTransition(game, { type: 'END_ROUND1' });
  checkEveryoneIn(game, 'round1');
  game = applyTransition(game, { type: 'COMPLETE_RETURN1' });

  // Round 2: plan assignments, then each chaser submits an exact-match chase.
  const plans = planAssignments(teams, spec.gameType, spec.seed);
  const scoreAssignments: ScoreAssignment[] = plans.map((plan, idx) => {
    const id = `a${idx}`;
    const chasePhotoId = `chase-${id}`;
    // Bots recreate the exact spot: chase location copies the original's.
    locations[chasePhotoId] = locations[plan.originalPhotoId]!;
    return {
      id,
      chaserTeamId: plan.chaserTeamId,
      ownerTeamId: plan.ownerTeamId,
      originalPhotoId: plan.originalPhotoId,
      chasePhotoId,
    };
  });

  game = applyTransition(game, { type: 'END_ROUND2' });
  checkEveryoneIn(game, 'round2');
  game = applyTransition(game, { type: 'COMPLETE_RETURN2' });

  // Rating: everyone not on the chasing team (plus judges) rates each chase.
  const chaserIndex = new Map(game.teams.map((t, i) => [t.id, i]));
  const votes: ScoreVote[] = [];
  for (const a of scoreAssignments) {
    const i = chaserIndex.get(a.chaserTeamId)!;
    for (const member of game.memberships) {
      const isJudge = member.role === 'judge' || member.role === 'spectator';
      if (!isJudge && member.teamId === a.chaserTeamId) continue; // no self-rating
      const weight = resolveVoteWeight(member.role, judgeWeight);
      votes.push({ assignmentId: a.id, axis: 'pose', stars: poseStars(i), weight });
      votes.push({ assignmentId: a.id, axis: 'angle', stars: angleStars(i), weight });
    }
  }

  game = applyTransition(game, { type: 'COMPLETE_RATING' });

  // Finals: best-overall-match goes to the leader on photo quality alone.
  const teamIds = game.teams.map((t) => t.id);
  const returnDurations = Object.fromEntries(
    game.teams.map((t, i) => [t.id, 100_000 * (i + 1)]),
  );
  const preFinals = computeScoreboard({ teamIds, assignments: scoreAssignments, locations, votes });
  const bestMatchTeamId = preFinals[0]?.teamId;

  game = applyTransition(game, { type: 'COMPLETE_FINALS' });

  const scoringInput: ScoringInput = {
    teamIds,
    assignments: scoreAssignments,
    locations,
    votes,
    returnDurations,
    bestMatchTeamId,
  };
  const scoreboard = computeScoreboard(scoringInput);

  return { finalState: game.state, scoreboard, scoringInput };
}
