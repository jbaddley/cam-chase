import type { GameType } from '../domain/enums.js';
import { mulberry32, shuffle } from './rng.js';

/** A team and the photos it captured in Round 1, in capture order. */
export interface TeamPhotos {
  teamId: string;
  photoIds: string[];
}

/** One Round 2 task: `chaserTeamId` must recreate `originalPhotoId`. */
export interface AssignmentPlan {
  chaserTeamId: string;
  originalPhotoId: string;
  ownerTeamId: string;
  /** Delivery order within the chasing team's Round 2 queue. */
  order: number;
}

/**
 * Round Robin: teams form a ring (by input order); each team chases the next
 * team's photos in their original capture order. The last team chases the first.
 */
function roundRobin(teams: TeamPhotos[]): AssignmentPlan[] {
  const n = teams.length;
  const plans: AssignmentPlan[] = [];
  for (let i = 0; i < n; i++) {
    const chaser = teams[i]!;
    const source = teams[(i + 1) % n]!;
    source.photoIds.forEach((originalPhotoId, order) => {
      plans.push({ chaserTeamId: chaser.teamId, originalPhotoId, ownerTeamId: source.teamId, order });
    });
  }
  return plans;
}

/**
 * Random: every photo is chased exactly once by a team other than its owner.
 * Photos are shuffled with the seed, then assigned to the least-loaded eligible
 * team (seeded tie-break) so load stays balanced. With ≥2 teams a non-owner is
 * always available, so assignment never fails.
 */
function random(teams: TeamPhotos[], seed: number): AssignmentPlan[] {
  const rng = mulberry32(seed);
  const photos = shuffle(
    teams.flatMap((t) => t.photoIds.map((originalPhotoId) => ({ originalPhotoId, ownerTeamId: t.teamId }))),
    rng,
  );
  const teamOrder = shuffle(teams.map((t) => t.teamId), rng);
  const load = new Map<string, number>(teamOrder.map((id) => [id, 0]));
  const nextOrder = new Map<string, number>(teamOrder.map((id) => [id, 0]));

  const plans: AssignmentPlan[] = [];
  for (const photo of photos) {
    let best: string | null = null;
    let bestLoad = Infinity;
    for (const teamId of teamOrder) {
      if (teamId === photo.ownerTeamId) continue;
      const l = load.get(teamId)!;
      if (l < bestLoad) {
        bestLoad = l;
        best = teamId;
      }
    }
    const chaserTeamId = best!;
    load.set(chaserTeamId, load.get(chaserTeamId)! + 1);
    const order = nextOrder.get(chaserTeamId)!;
    nextOrder.set(chaserTeamId, order + 1);
    plans.push({ chaserTeamId, originalPhotoId: photo.originalPhotoId, ownerTeamId: photo.ownerTeamId, order });
  }
  return plans;
}

/**
 * Produce the Round 2 assignment plan for a game. Deterministic given `seed`.
 */
export function planAssignments(
  teams: TeamPhotos[],
  gameType: GameType,
  seed: number,
): AssignmentPlan[] {
  if (teams.length < 2) {
    throw new Error('Assignment requires at least 2 teams.');
  }
  return gameType === 'round_robin' ? roundRobin(teams) : random(teams, seed);
}
