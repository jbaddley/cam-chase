import {
  applyTransition,
  BEST_OVERALL_CATEGORY,
  computeScoreboard,
  GameConfigSchema,
  isWithinGeofence,
  planAssignments,
  resolveFinals,
  resolveVoteWeight,
  validateConfigForTier,
  type Assignment,
  type Game,
  type GameEvent,
  type GeoPoint,
  type ScoreAssignment,
  type ScoreVote,
  type TeamPhotos,
  type TeamScore,
  type Tier,
} from '@photochase/shared';
import { z } from 'zod';
import { newId, newJoinCode } from './ids.js';
import type { GameRepository } from './repository.js';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const err = (error: string): Result<never> => ({ ok: false, error });

/** Derive a stable numeric seed from a game's code for reproducible assignment. */
function seedFromCode(code: string): number {
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- createGame -------------------------------------------------------------

const CreateGameInput = z.object({
  hostUserId: z.string().min(1),
  tier: z.enum(['free', 'game_pack', 'unlimited']),
  config: GameConfigSchema,
});

export async function createGame(
  repo: GameRepository,
  raw: unknown,
  now = Date.now,
): Promise<Result<{ gameId: string; code: string }>> {
  const parsed = CreateGameInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { hostUserId, tier, config } = parsed.data;

  const gate = validateConfigForTier(config, tier as Tier);
  if (!gate.ok) return err(gate.errors.join(' '));

  let code = newJoinCode();
  while (await repo.getByCode(code)) code = newJoinCode();

  const game: Game = {
    id: newId('game'),
    hostUserId,
    code,
    tier,
    config,
    state: 'draft',
    teams: [],
    memberships: [],
    photos: [],
    assignments: [],
    votes: [],
    createdAt: now(),
  };
  const opened = applyTransition(game, { type: 'OPEN_LOBBY' });
  await repo.save(opened);
  return ok({ gameId: opened.id, code: opened.code });
}

// --- joinByCode -------------------------------------------------------------

const JoinInput = z.object({
  code: z.string().min(1),
  userId: z.string().min(1),
  displayName: z.string().min(1),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('create_team'), name: z.string().min(1).max(40) }),
    z.object({ type: z.literal('join_team'), teamId: z.string().min(1) }),
    z.object({ type: z.literal('judge') }),
    z.object({ type: z.literal('spectator') }),
  ]),
});

export async function joinByCode(
  repo: GameRepository,
  raw: unknown,
): Promise<Result<{ gameId: string; teamId: string | null; role: string }>> {
  const parsed = JoinInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { code, userId, action } = parsed.data;

  const game = await repo.getByCode(code);
  if (!game) return err('Game not found.');
  if (game.state !== 'lobby') return err('Game is not accepting joins.');
  if (game.memberships.some((m) => m.userId === userId)) return err('Already joined.');

  let teamId: string | null = null;
  let role: 'captain' | 'member' | 'judge' | 'spectator';

  if (action.type === 'create_team') {
    if (game.teams.length >= game.config.maxTeams) return err('Game is full.');
    teamId = newId('team');
    game.teams.push({ id: teamId, gameId: game.id, name: action.name, createdAt: Date.now() });
    role = 'captain';
  } else if (action.type === 'join_team') {
    const team = game.teams.find((t) => t.id === action.teamId);
    if (!team) return err('Team not found.');
    teamId = team.id;
    role = 'member';
  } else {
    role = action.type;
  }

  game.memberships.push({
    id: newId('mem'),
    gameId: game.id,
    userId,
    teamId,
    role,
    returnCheckins: {},
  });
  await repo.save(game);
  return ok({ gameId: game.id, teamId, role });
}

// --- listTeams --------------------------------------------------------------

export async function listTeams(
  repo: GameRepository,
  gameId: string,
): Promise<Result<Array<{ teamId: string; name: string; memberCount: number }>>> {
  const game = await repo.get(gameId);
  if (!game) return err('Game not found.');
  const teams = game.teams.map((t) => ({
    teamId: t.id,
    name: t.name,
    memberCount: game.memberships.filter((m) => m.teamId === t.id).length,
  }));
  return ok(teams);
}

// --- getGameState -----------------------------------------------------------

/** A sanitized public view of a game, safe for any participant to poll. */
export interface GameStateView {
  id: string;
  code: string;
  state: Game['state'];
  config: Game['config'];
  teams: Array<{ teamId: string; name: string; memberCount: number }>;
  playerCount: number;
}

/**
 * Read a game's current state for lobby and in-play polling. Returns only
 * public fields — team roster counts and config — never raw memberships,
 * photos, or votes, which could leak other players' data.
 */
export async function getGameState(repo: GameRepository, gameId: string): Promise<Result<GameStateView>> {
  const game = await repo.get(gameId);
  if (!game) return err('Game not found.');
  return ok({
    id: game.id,
    code: game.code,
    state: game.state,
    config: game.config,
    teams: game.teams.map((t) => ({
      teamId: t.id,
      name: t.name,
      memberCount: game.memberships.filter((m) => m.teamId === t.id).length,
    })),
    playerCount: game.memberships.length,
  });
}

// --- listAssignments --------------------------------------------------------

/** One Round 2 task as seen by the chasing team. */
export interface AssignmentView {
  assignmentId: string;
  order: number;
  originalPhotoId: string;
  /** S3 key of the photo to recreate; exchange for a URL via /downloads. */
  originalPhotoKey: string;
  /** Set once this team has submitted its chase. */
  chasePhotoId: string | null;
}

/**
 * The caller's team's Round 2 queue, in delivery order. Scoped to the caller's
 * own team — a player can never enumerate another team's assignments, which
 * would reveal which photos they have to find. Judges and spectators have no
 * team and so get an empty queue.
 */
export async function listAssignments(
  repo: GameRepository,
  input: { gameId: string; userId: string },
): Promise<Result<AssignmentView[]>> {
  const game = await repo.get(input.gameId);
  if (!game) return err('Game not found.');

  const membership = game.memberships.find((m) => m.userId === input.userId);
  if (!membership) return err('You are not in this game.');
  if (!membership.teamId) return ok([]); // judges/spectators don't chase

  const photoKey = new Map(game.photos.map((p) => [p.id, p.s3Key]));
  const mine = game.assignments
    .filter((a) => a.chaserTeamId === membership.teamId)
    .sort((a, b) => a.order - b.order)
    .map((a): AssignmentView => ({
      assignmentId: a.id,
      order: a.order,
      originalPhotoId: a.originalPhotoId,
      originalPhotoKey: photoKey.get(a.originalPhotoId) ?? '',
      chasePhotoId: a.chasePhotoId,
    }));
  return ok(mine);
}

// --- listRateable -----------------------------------------------------------

/** A chase attempt the caller is allowed to rate, paired with its original. */
export interface RateableView {
  assignmentId: string;
  originalPhotoId: string;
  originalPhotoKey: string;
  chasePhotoId: string;
  chasePhotoKey: string;
  /** Stars this user has already given on each axis, if any. */
  myVotes: { pose: number | null; angle: number | null };
}

/**
 * The chases the caller may rate, paired with the originals they recreate.
 * Mirrors the authorization in {@link castVote}: teams cannot rate their own
 * chase, while judges and spectators may rate everything. Only assignments with
 * a submitted chase appear — there is nothing to compare otherwise.
 */
export async function listRateable(
  repo: GameRepository,
  input: { gameId: string; userId: string },
): Promise<Result<RateableView[]>> {
  const game = await repo.get(input.gameId);
  if (!game) return err('Game not found.');

  const membership = game.memberships.find((m) => m.userId === input.userId);
  if (!membership) return err('You are not in this game.');

  const photoKey = new Map(game.photos.map((p) => [p.id, p.s3Key]));
  const myVote = (assignmentId: string, axis: 'pose' | 'angle'): number | null =>
    game.votes.find((v) => v.assignmentId === assignmentId && v.voterUserId === input.userId && v.axis === axis)
      ?.stars ?? null;

  const rateable = game.assignments
    .filter((a) => a.chasePhotoId !== null)
    .filter((a) => membership.teamId === null || a.chaserTeamId !== membership.teamId)
    .sort((a, b) => a.order - b.order)
    .map((a): RateableView => ({
      assignmentId: a.id,
      originalPhotoId: a.originalPhotoId,
      originalPhotoKey: photoKey.get(a.originalPhotoId) ?? '',
      chasePhotoId: a.chasePhotoId!,
      chasePhotoKey: photoKey.get(a.chasePhotoId!) ?? '',
      myVotes: { pose: myVote(a.id, 'pose'), angle: myVote(a.id, 'angle') },
    }));
  return ok(rateable);
}

// --- startGame & advanceGame ------------------------------------------------

/**
 * Record when a round became active, so return check-ins can be turned into
 * durations. Idempotent — a round keeps the first start time it was given.
 */
function stampRoundStart(game: Game, now = Date.now): void {
  const round = game.state === 'round1_active' ? 'round1' : game.state === 'round2_active' ? 'round2' : null;
  if (!round) return;
  game.roundStartedAt ??= {};
  game.roundStartedAt[round] ??= now();
}

async function requireHost(
  repo: GameRepository,
  gameId: string,
  hostUserId: string,
): Promise<Result<Game>> {
  const game = await repo.get(gameId);
  if (!game) return err('Game not found.');
  if (game.hostUserId !== hostUserId) return err('Only the host can do that.');
  return ok(game);
}

export async function startGame(
  repo: GameRepository,
  input: { gameId: string; hostUserId: string },
): Promise<Result<{ state: Game['state'] }>> {
  const found = await requireHost(repo, input.gameId, input.hostUserId);
  if (!found.ok) return found;
  try {
    const started = applyTransition(found.data, { type: 'START_GAME' });
    stampRoundStart(started);
    await repo.save(started);
    return ok({ state: started.state });
  } catch (e) {
    return err((e as Error).message);
  }
}

/** Group a game's Round 1 photos into per-team lists in capture order. */
function teamPhotos(game: Game): TeamPhotos[] {
  return game.teams.map((t) => ({
    teamId: t.id,
    photoIds: game.photos
      .filter((p) => p.teamId === t.id)
      .sort((a, b) => a.order - b.order)
      .map((p) => p.id),
  }));
}

export async function advanceGame(
  repo: GameRepository,
  input: { gameId: string; hostUserId: string; event: GameEvent['type'] },
): Promise<Result<{ state: Game['state'] }>> {
  const found = await requireHost(repo, input.gameId, input.hostUserId);
  if (!found.ok) return found;
  const game = found.data;
  try {
    const advanced = applyTransition(game, { type: input.event } as GameEvent);
    // Entering Round 2: generate the assignment plan deterministically.
    if (advanced.state === 'round2_active' && advanced.assignments.length === 0) {
      const plans = planAssignments(teamPhotos(advanced), advanced.config.gameType, seedFromCode(advanced.code));
      advanced.assignments = plans.map((p): Assignment => ({
        id: newId('asg'),
        gameId: advanced.id,
        chaserTeamId: p.chaserTeamId,
        originalPhotoId: p.originalPhotoId,
        order: p.order,
        chasePhotoId: null,
      }));
    }
    stampRoundStart(advanced);
    await repo.save(advanced);
    return ok({ state: advanced.state });
  } catch (e) {
    return err((e as Error).message);
  }
}

// --- gameplay writes --------------------------------------------------------

const SubmitPhotoInput = z.object({
  gameId: z.string(),
  teamId: z.string(),
  shooterUserId: z.string(),
  location: z.object({ lat: z.number(), lng: z.number(), accuracyM: z.number().optional() }),
  s3Key: z.string(),
});

export async function submitPhoto(repo: GameRepository, raw: unknown): Promise<Result<{ photoId: string }>> {
  const parsed = SubmitPhotoInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { gameId, teamId, shooterUserId, location, s3Key } = parsed.data;
  const game = await repo.get(gameId);
  if (!game) return err('Game not found.');
  if (game.state !== 'round1_active') return err('Not in Round 1.');
  const order = game.photos.filter((p) => p.teamId === teamId).length;
  if (order >= game.config.photosPerRound) return err('Photo quota reached.');
  const photoId = newId('photo');
  game.photos.push({
    id: photoId,
    gameId,
    teamId,
    shooterUserId,
    order,
    location: location as GeoPoint,
    capturedAt: Date.now(),
    s3Key,
    fouls: [],
  });
  await repo.save(game);
  return ok({ photoId });
}

const SubmitChaseInput = z.object({
  gameId: z.string(),
  assignmentId: z.string(),
  location: z.object({ lat: z.number(), lng: z.number(), accuracyM: z.number().optional() }),
  s3Key: z.string(),
  shooterUserId: z.string(),
});

export async function submitChase(repo: GameRepository, raw: unknown): Promise<Result<{ chasePhotoId: string }>> {
  const parsed = SubmitChaseInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { gameId, assignmentId, location, s3Key, shooterUserId } = parsed.data;
  const game = await repo.get(gameId);
  if (!game) return err('Game not found.');
  if (game.state !== 'round2_active') return err('Not in Round 2.');
  const assignment = game.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return err('Assignment not found.');
  const chasePhotoId = newId('photo');
  game.photos.push({
    id: chasePhotoId,
    gameId,
    teamId: assignment.chaserTeamId,
    shooterUserId,
    order: assignment.order,
    location: location as GeoPoint,
    capturedAt: Date.now(),
    s3Key,
    fouls: [],
  });
  assignment.chasePhotoId = chasePhotoId;
  await repo.save(game);
  return ok({ chasePhotoId });
}

const CastVoteInput = z.object({
  gameId: z.string(),
  assignmentId: z.string(),
  voterUserId: z.string(),
  axis: z.enum(['pose', 'angle']),
  stars: z.number().int().min(1).max(5),
});

export async function castVote(repo: GameRepository, raw: unknown): Promise<Result<{ voteId: string }>> {
  const parsed = CastVoteInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { gameId, assignmentId, voterUserId, axis, stars } = parsed.data;
  const game = await repo.get(gameId);
  if (!game) return err('Game not found.');
  if (game.state !== 'rating') return err('Not in the rating phase.');
  const assignment = game.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return err('Assignment not found.');
  const voter = game.memberships.find((m) => m.userId === voterUserId);
  if (!voter) return err('Voter is not in this game.');
  const isJudge = voter.role === 'judge' || voter.role === 'spectator';
  if (!isJudge && voter.teamId === assignment.chaserTeamId) return err('Cannot rate your own chase.');
  const voteId = newId('vote');
  game.votes.push({ id: voteId, gameId, assignmentId, voterUserId, axis, stars });
  await repo.save(game);
  return ok({ voteId });
}

// --- return check-in --------------------------------------------------------

const CheckinInput = z.object({
  gameId: z.string(),
  userId: z.string().min(1),
  location: z.object({ lat: z.number(), lng: z.number(), accuracyM: z.number().optional() }),
});

/** Which round a return phase belongs to, or null outside those phases. */
function returningRound(state: Game['state']): 'round1' | 'round2' | null {
  if (state === 'round1_return') return 'round1';
  if (state === 'round2_return') return 'round2';
  return null;
}

/**
 * Check a team in at the return spot. Only meaningful during a return phase,
 * and only for players on a team. When a return geofence is configured the
 * check-in must be inside it — a team has to actually get back. The earliest
 * check-in per member stands; re-checking in never worsens the recorded time.
 */
export async function checkIn(
  repo: GameRepository,
  raw: unknown,
  now = Date.now,
): Promise<Result<{ round: 'round1' | 'round2'; at: number }>> {
  const parsed = CheckinInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { gameId, userId, location } = parsed.data;

  const game = await repo.get(gameId);
  if (!game) return err('Game not found.');

  const round = returningRound(game.state);
  if (!round) return err('Not in a return phase.');

  const membership = game.memberships.find((m) => m.userId === userId);
  if (!membership) return err('You are not in this game.');
  if (!membership.teamId) return err('Only players on a team check in.');

  const spot = game.config.returnSpot;
  if (spot && !isWithinGeofence(location as GeoPoint, { center: { lat: spot.lat, lng: spot.lng }, radiusM: spot.radiusM })) {
    return err('You are not at the return spot yet.');
  }

  const at = now();
  membership.returnCheckins[round] ??= at;
  await repo.save(game);
  return ok({ round, at: membership.returnCheckins[round]! });
}

/**
 * Per-team return durations, summed across rounds. A team's time for a round is
 * its earliest member check-in; teams that never checked in are omitted so they
 * simply place last rather than scoring as instant returns.
 */
function returnDurations(game: Game): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const round of ['round1', 'round2'] as const) {
    const startedAt = game.roundStartedAt?.[round];
    if (startedAt === undefined) continue;

    const earliest: Record<string, number> = {};
    for (const m of game.memberships) {
      const at = m.returnCheckins[round];
      if (at === undefined || !m.teamId) continue;
      const duration = at - startedAt;
      if (duration < 0) continue;
      if (earliest[m.teamId] === undefined || duration < earliest[m.teamId]!) earliest[m.teamId] = duration;
    }
    for (const [teamId, duration] of Object.entries(earliest)) {
      totals[teamId] = (totals[teamId] ?? 0) + duration;
    }
  }
  return totals;
}

// --- finals voting ----------------------------------------------------------

/** The categories open for voting, plus what this caller has already picked. */
export interface FinalsView {
  categories: Array<{ id: string; label: string }>;
  teams: Array<{ teamId: string; name: string }>;
  /** category id → teamId this user voted for. */
  myVotes: Record<string, string>;
}

/** Every category up for a finals vote: best-overall plus the configured extras. */
function finalsCategories(game: Game): Array<{ id: string; label: string }> {
  const { presets, custom } = game.config.specialCategories;
  return [
    { id: BEST_OVERALL_CATEGORY, label: 'Best overall match' },
    ...presets.map((p) => ({ id: p, label: p })),
    ...custom.map((c) => ({ id: c, label: c })),
  ];
}

export async function getFinals(
  repo: GameRepository,
  input: { gameId: string; userId: string },
): Promise<Result<FinalsView>> {
  const game = await repo.get(input.gameId);
  if (!game) return err('Game not found.');
  const membership = game.memberships.find((m) => m.userId === input.userId);
  if (!membership) return err('You are not in this game.');

  const myVotes: Record<string, string> = {};
  for (const v of game.finalsVotes ?? []) {
    if (v.voterUserId === input.userId) myVotes[v.category] = v.teamId;
  }
  return ok({
    categories: finalsCategories(game),
    teams: game.teams.map((t) => ({ teamId: t.id, name: t.name })),
    myVotes,
  });
}

const FinalsVoteInput = z.object({
  gameId: z.string(),
  voterUserId: z.string().min(1),
  category: z.string().min(1),
  teamId: z.string().min(1),
});

/**
 * Cast (or change) a finals vote. One vote per voter per category — re-voting
 * replaces the previous pick rather than stacking.
 */
export async function castFinalsVote(repo: GameRepository, raw: unknown): Promise<Result<{ category: string; teamId: string }>> {
  const parsed = FinalsVoteInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { gameId, voterUserId, category, teamId } = parsed.data;

  const game = await repo.get(gameId);
  if (!game) return err('Game not found.');
  if (game.state !== 'finals_voting') return err('Not in the finals voting phase.');

  const voter = game.memberships.find((m) => m.userId === voterUserId);
  if (!voter) return err('You are not in this game.');
  if (!game.teams.some((t) => t.id === teamId)) return err('Team not found.');
  if (voter.teamId === teamId) return err('Cannot vote for your own team.');
  if (!finalsCategories(game).some((c) => c.id === category)) return err('Unknown category.');

  const votes = game.finalsVotes ?? (game.finalsVotes = []);
  const existing = votes.findIndex((v) => v.voterUserId === voterUserId && v.category === category);
  if (existing >= 0) votes[existing] = { voterUserId, category, teamId };
  else votes.push({ voterUserId, category, teamId });

  await repo.save(game);
  return ok({ category, teamId });
}

// --- getResults -------------------------------------------------------------

export async function getResults(
  repo: GameRepository,
  gameId: string,
): Promise<Result<{ scoreboard: TeamScore[] }>> {
  const game = await repo.get(gameId);
  if (!game) return err('Game not found.');
  if (!['rating', 'finals_voting', 'results'].includes(game.state)) {
    return err('Results are not available yet.');
  }

  const locations: Record<string, GeoPoint> = {};
  for (const p of game.photos) locations[p.id] = p.location;

  const assignments: ScoreAssignment[] = game.assignments.map((a) => ({
    id: a.id,
    chaserTeamId: a.chaserTeamId,
    ownerTeamId: game.photos.find((p) => p.id === a.originalPhotoId)?.teamId ?? '',
    originalPhotoId: a.originalPhotoId,
    chasePhotoId: a.chasePhotoId,
  }));

  const roleByUser = new Map(game.memberships.map((m) => [m.userId, m.role]));
  const votes: ScoreVote[] = game.votes.map((v) => ({
    assignmentId: v.assignmentId,
    axis: v.axis,
    stars: v.stars,
    weight: resolveVoteWeight(roleByUser.get(v.voterUserId) ?? 'member', game.config.judgeWeight),
  }));

  const fouls: Record<string, number> = {};
  for (const p of game.photos) {
    if (p.fouls.length > 0) fouls[p.teamId] = (fouls[p.teamId] ?? 0) + p.fouls.length;
  }

  // Finals bonuses come from the actual weighted finals votes. With no finals
  // votes cast, no best-match or special bonus is awarded.
  const finals = resolveFinals(
    (game.finalsVotes ?? []).map((v) => ({
      category: v.category,
      teamId: v.teamId,
      weight: resolveVoteWeight(roleByUser.get(v.voterUserId) ?? 'member', game.config.judgeWeight),
    })),
  );

  const teamIds = game.teams.map((t) => t.id);
  const scoreboard = computeScoreboard({
    teamIds,
    assignments,
    locations,
    votes,
    fouls,
    bestMatchTeamId: finals.bestMatchTeamId,
    specialWinners: finals.specialWinners,
    returnDurations: returnDurations(game),
  });
  return ok({ scoreboard });
}
