import {
  applyTransition,
  BEST_OVERALL_CATEGORY,
  generateHuntList,
  modeOf,
  pickWildcard,
  resolveHuntFinds,
  scoreScavenger,
  visibleHuntItems,
  computeScoreboard,
  FOUL_REASONS,
  RATING_AXES,
  GameConfigSchema,
  isWithinGeofence,
  planAssignments,
  resolveFinals,
  resolveVoteWeight,
  validateConfigForTier,
  type Assignment,
  type FoulReason,
  type Game,
  type GameEvent,
  type GeoPoint,
  type Photo,
  type ScoreAssignment,
  type ScoreVote,
  type TeamPhotos,
  type HuntClaim,
  type HuntItem,
  type RatingAxis,
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
  /** The league this game counts toward, already resolved from its code. */
  tournamentId: z.string().min(1).optional(),
});

export async function createGame(
  repo: GameRepository,
  raw: unknown,
  now = Date.now,
): Promise<Result<{ gameId: string; code: string }>> {
  const parsed = CreateGameInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { hostUserId, tier, config, tournamentId } = parsed.data;

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
    ...(tournamentId ? { tournamentId } : {}),
    createdAt: now(),
  };
  if ((config.mode ?? 'photo_chase') === 'scavenger_hunt') {
    // One list for the whole game, seeded from the code so it is reproducible
    // and identical for every team. The wildcard sits on the list from the
    // start — scoring needs its rarity — but stays hidden until the reveal time
    // stamped when Round 1 begins; see `stampRoundStart`.
    const theme = config.huntTheme ?? 'mixed';
    const seed = seedFromCode(game.code);
    const items = generateHuntList({ theme, count: config.photosPerRound, seed });
    const wildcard = pickWildcard({ theme, exclude: items, seed });
    game.hunt = wildcard
      ? { items: [...items, wildcard], wildcardItemId: wildcard.id }
      : { items };
  }

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
  /**
   * The tier this lobby plays at — the host's, since only the host's plan gates
   * a game. Already true of the engine; surfacing it is what lets the lobby say
   * "you are all playing on the host's plan", which is the most honest reason a
   * subscriber has to invite people.
   */
  hostTier: Tier;
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
    hostTier: game.tier,
  });
}

// --- spectate ---------------------------------------------------------------

/** What a big-screen viewer sees: the public game view plus final standings. */
export interface SpectatorView {
  game: GameStateView;
  /** Present once the game has reached a scorable phase. */
  scoreboard: TeamScore[] | null;
}

/**
 * Resolve a join code to the spectator view. Reached without authentication —
 * a TV browser has nobody signed in — so it deliberately returns only the same
 * sanitized fields the in-app view uses: state, config, team names and counts.
 * No photos, memberships, or user identities.
 */
export async function getSpectatorView(repo: GameRepository, code: string): Promise<Result<SpectatorView>> {
  const game = await repo.getByCode(code);
  if (!game) return err('Game not found.');

  const view = await getGameState(repo, game.id);
  if (!view.ok) return view;

  const results = await getResults(repo, game.id);
  return ok({ game: view.data, scoreboard: results.ok ? results.data.scoreboard : null });
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

// --- listHuntItems ----------------------------------------------------------

/** One item on a scavenger hunt list, with the caller's team's progress on it. */
export interface HuntItemView {
  itemId: string;
  label: string;
  rarity: HuntItem['rarity'];
  /** The mid-round wildcard, which pays double. */
  wildcard: boolean;
  /** The caller's team's photo claiming this item, once one is submitted. */
  claimedPhotoId: string | null;
}

export interface HuntView {
  items: HuntItemView[];
  /**
   * When the wildcard drops, so the client can run a countdown. Present before
   * the reveal too — knowing one is coming is the tension; the item itself is
   * withheld until the time passes.
   */
  wildcardRevealAt: number | null;
}

/**
 * The hunt list as this caller may see it. Every team hunts the same items, so
 * nothing here is secret except the wildcard before its reveal time — which is
 * why the list is filtered through {@link visibleHuntItems} rather than served
 * raw. Judges and spectators see the list with no progress marked.
 */
export async function listHuntItems(
  repo: GameRepository,
  input: { gameId: string; userId: string },
  now = Date.now,
): Promise<Result<HuntView>> {
  const game = await repo.get(input.gameId);
  if (!game) return err('Game not found.');
  if (modeOf(game) !== 'scavenger_hunt') return err('This game is not a scavenger hunt.');

  const membership = game.memberships.find((m) => m.userId === input.userId);
  if (!membership) return err('You are not in this game.');

  const hunt = game.hunt ?? { items: [] };
  const claimed = new Map(
    game.photos
      .filter((p) => p.itemId !== undefined && p.teamId === membership.teamId)
      .map((p) => [p.itemId!, p.id]),
  );

  return ok({
    items: visibleHuntItems(hunt, now()).map((item): HuntItemView => ({
      itemId: item.id,
      label: item.label,
      rarity: item.rarity,
      wildcard: item.id === hunt.wildcardItemId,
      claimedPhotoId: claimed.get(item.id) ?? null,
    })),
    wildcardRevealAt: hunt.wildcardRevealAt ?? null,
  });
}

// --- listRateable -----------------------------------------------------------

/**
 * One thing the caller is allowed to rate.
 *
 * In a chase that is an attempt paired with the original it recreates. In a
 * scavenger hunt there is no original — the subject is the claim photo itself,
 * so both ids point at that one photo and `itemLabel` carries what it is being
 * judged against. `assignmentId` is the vote's subject either way.
 */
export interface RateableView {
  assignmentId: string;
  originalPhotoId: string;
  originalPhotoKey: string;
  chasePhotoId: string;
  chasePhotoKey: string;
  /** Stars this user has already given on each axis, if any. */
  myVotes: { pose: number | null; angle: number | null; validity: number | null };
  /** Fouls currently called on the original photo. */
  originalFouls: FoulReason[];
  /** Scavenger Hunt: the list item this photo claims. */
  itemId?: string;
  itemLabel?: string;
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
  const photoFouls = new Map(game.photos.map((p) => [p.id, p.fouls]));
  const myVote = (assignmentId: string, axis: RatingAxis): number | null =>
    game.votes.find((v) => v.assignmentId === assignmentId && v.voterUserId === input.userId && v.axis === axis)
      ?.stars ?? null;

  // A hunt is judged photo by photo against the item claimed, so the queue is
  // built from claim photos rather than assignments — a hunt has none.
  if (modeOf(game) === 'scavenger_hunt') {
    const labels = new Map((game.hunt?.items ?? []).map((i) => [i.id, i.label]));
    const claims = game.photos
      .filter((p) => p.itemId !== undefined)
      .filter((p) => membership.teamId === null || p.teamId !== membership.teamId)
      .sort((a, b) => a.order - b.order)
      .map((p): RateableView => ({
        assignmentId: p.id,
        originalPhotoId: p.id,
        originalPhotoKey: p.s3Key,
        chasePhotoId: p.id,
        chasePhotoKey: p.s3Key,
        myVotes: { pose: null, angle: null, validity: myVote(p.id, 'validity') },
        originalFouls: [...p.fouls],
        itemId: p.itemId!,
        itemLabel: labels.get(p.itemId!) ?? p.itemId!,
      }));
    return ok(claims);
  }

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
      myVotes: { pose: myVote(a.id, 'pose'), angle: myVote(a.id, 'angle'), validity: null },
      originalFouls: [...(photoFouls.get(a.originalPhotoId) ?? [])],
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

  // A hunt's wildcard drops halfway through the round: late enough that teams
  // have committed to a route, early enough that they can still act on it.
  if (round === 'round1' && game.hunt?.wildcardItemId && game.hunt.wildcardRevealAt === undefined) {
    game.hunt.wildcardRevealAt = game.roundStartedAt.round1! + (game.config.round1Minutes * 60_000) / 2;
  }
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
  /** Scavenger Hunt: which list item this photo claims. */
  itemId: z.string().min(1).optional(),
});

export async function submitPhoto(
  repo: GameRepository,
  raw: unknown,
  now = Date.now,
): Promise<Result<{ photoId: string }>> {
  const parsed = SubmitPhotoInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { gameId, teamId, shooterUserId, location, s3Key, itemId } = parsed.data;
  const game = await repo.get(gameId);
  if (!game) return err('Game not found.');
  if (game.state !== 'round1_active') return err('Not in Round 1.');

  const isHunt = modeOf(game) === 'scavenger_hunt';
  if (isHunt) {
    if (!itemId) return err('Pick the item this photo claims.');
    // Checked against the *visible* list, so an unrevealed wildcard cannot be
    // claimed by a client that guessed its id.
    const visible = visibleHuntItems(game.hunt ?? { items: [] }, now());
    if (!visible.some((i) => i.id === itemId)) return err('That item is not on this hunt.');
  }

  const order = game.photos.filter((p) => p.teamId === teamId).length;
  // A hunt's quota is its list: every item is claimable, wildcard included.
  const quota = isHunt ? (game.hunt?.items.length ?? 0) : game.config.photosPerRound;
  if (order >= quota) return err('Photo quota reached.');

  const photoId = newId('photo');
  game.photos.push({
    id: photoId,
    gameId,
    teamId,
    shooterUserId,
    order,
    location: location as GeoPoint,
    capturedAt: now(),
    s3Key,
    ...(itemId ? { itemId } : {}),
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
  axis: z.enum(RATING_AXES),
  stars: z.number().int().min(1).max(5),
});

/**
 * Rate one subject. In a chase the subject is an assignment, scored on pose and
 * angle; in a hunt it is a claim photo, scored only on validity. Each mode
 * rejects the other's axes so a stray vote cannot land in a column its scorer
 * never reads.
 */
export async function castVote(repo: GameRepository, raw: unknown): Promise<Result<{ voteId: string }>> {
  const parsed = CastVoteInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { gameId, assignmentId, voterUserId, axis, stars } = parsed.data;
  const game = await repo.get(gameId);
  if (!game) return err('Game not found.');
  if (game.state !== 'rating') return err('Not in the rating phase.');

  const voter = game.memberships.find((m) => m.userId === voterUserId);
  if (!voter) return err('Voter is not in this game.');
  const isJudge = voter.role === 'judge' || voter.role === 'spectator';

  if (modeOf(game) === 'scavenger_hunt') {
    if (axis !== 'validity') return err('A scavenger hunt is rated on validity.');
    const photo = game.photos.find((p) => p.id === assignmentId && p.itemId !== undefined);
    if (!photo) return err('Claim not found.');
    if (!isJudge && voter.teamId === photo.teamId) return err("Cannot rate your own team's find.");
  } else {
    if (axis === 'validity') return err('Validity only applies to a scavenger hunt.');
    const assignment = game.assignments.find((a) => a.id === assignmentId);
    if (!assignment) return err('Assignment not found.');
    if (!isJudge && voter.teamId === assignment.chaserTeamId) return err('Cannot rate your own chase.');
  }

  const voteId = newId('vote');
  game.votes.push({ id: voteId, gameId, assignmentId, voterUserId, axis, stars });
  await repo.save(game);
  return ok({ voteId });
}

// --- fouls ------------------------------------------------------------------

const FoulInput = z.object({
  gameId: z.string(),
  photoId: z.string().min(1),
  userId: z.string().min(1),
  reason: z.enum(FOUL_REASONS),
});

/**
 * Shared authorization for raising and clearing a foul. A foul is a claim about
 * someone else's photo — you cannot call one on your own team — and it only
 * makes sense once the photos are on screen for comparison.
 */
async function requireFoulable(
  repo: GameRepository,
  input: { gameId: string; photoId: string; userId: string },
): Promise<Result<{ game: Game; photo: Photo }>> {
  const game = await repo.get(input.gameId);
  if (!game) return err('Game not found.');
  if (!['rating', 'finals_voting'].includes(game.state)) return err('Fouls can only be called during rating.');

  const membership = game.memberships.find((m) => m.userId === input.userId);
  if (!membership) return err('You are not in this game.');

  const photo = game.photos.find((p) => p.id === input.photoId);
  if (!photo) return err('Photo not found.');
  if (membership.teamId === photo.teamId) return err('Cannot call a foul on your own team.');

  return ok({ game, photo });
}

/** Raise a foul on a photo. Repeating the same reason does not stack. */
export async function flagFoul(repo: GameRepository, raw: unknown): Promise<Result<{ fouls: FoulReason[] }>> {
  const parsed = FoulInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { reason } = parsed.data;

  const found = await requireFoulable(repo, parsed.data);
  if (!found.ok) return found;
  const { game, photo } = found.data;

  if (!photo.fouls.includes(reason)) photo.fouls.push(reason);
  await repo.save(game);
  return ok({ fouls: [...photo.fouls] });
}

/** Clear a foul, so a wrongly-called one can be taken back. */
export async function clearFoul(repo: GameRepository, raw: unknown): Promise<Result<{ fouls: FoulReason[] }>> {
  const parsed = FoulInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { reason } = parsed.data;

  const found = await requireFoulable(repo, parsed.data);
  if (!found.ok) return found;
  const { game, photo } = found.data;

  photo.fouls = photo.fouls.filter((f) => f !== reason);
  await repo.save(game);
  return ok({ fouls: [...photo.fouls] });
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

  const roleByUser = new Map(game.memberships.map((m) => [m.userId, m.role]));
  const weightOf = (userId: string): number =>
    resolveVoteWeight(roleByUser.get(userId) ?? 'member', game.config.judgeWeight);

  // Finals bonuses come from the actual weighted finals votes. With no finals
  // votes cast, no best-match or special bonus is awarded.
  const finals = resolveFinals(
    (game.finalsVotes ?? []).map((v) => ({
      category: v.category,
      teamId: v.teamId,
      weight: weightOf(v.voterUserId),
    })),
  );

  const teamIds = game.teams.map((t) => t.id);

  if (modeOf(game) === 'scavenger_hunt') {
    // `missing_item` is deliberately left out of the foul tally: it already
    // voids the find below, and charging for it as well is double jeopardy.
    const huntFouls: Record<string, number> = {};
    for (const p of game.photos) {
      const counted = p.fouls.filter((f) => f !== 'missing_item').length;
      if (counted > 0) huntFouls[p.teamId] = (huntFouls[p.teamId] ?? 0) + counted;
    }

    const claims: HuntClaim[] = game.photos
      .filter((p) => p.itemId !== undefined)
      .map((p) => ({
        teamId: p.teamId,
        itemId: p.itemId!,
        validityVotes: game.votes
          .filter((v) => v.assignmentId === p.id && v.axis === 'validity')
          .map((v) => ({ stars: v.stars, weight: weightOf(v.voterUserId) })),
        disputed: p.fouls.includes('missing_item'),
      }));

    return ok({
      scoreboard: scoreScavenger({
        teamIds,
        items: game.hunt?.items ?? [],
        ...(game.hunt?.wildcardItemId ? { wildcardItemId: game.hunt.wildcardItemId } : {}),
        finds: resolveHuntFinds(claims),
        fouls: huntFouls,
        bestMatchTeamId: finals.bestMatchTeamId,
        specialWinners: finals.specialWinners,
        returnDurations: returnDurations(game),
      }),
    });
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

  const votes: ScoreVote[] = game.votes.map((v) => ({
    assignmentId: v.assignmentId,
    axis: v.axis,
    stars: v.stars,
    weight: weightOf(v.voterUserId),
  }));

  const fouls: Record<string, number> = {};
  for (const p of game.photos) {
    if (p.fouls.length > 0) fouls[p.teamId] = (fouls[p.teamId] ?? 0) + p.fouls.length;
  }

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
