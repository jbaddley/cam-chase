import {
  applyTransition,
  BEST_OVERALL_CATEGORY,
  assignAttributeSets,
  assignTagRoles,
  describeAttributeSet,
  isHunterNearby,
  scoreTag,
  generateHuntList,
  modeOf,
  scoreColorHunt,
  pickWildcard,
  resolveHuntFinds,
  VALIDITY_THRESHOLD,
  scoreScavenger,
  visibleHuntItems,
  computeScoreboard,
  COLORS,
  MOTIFS,
  SHAPES,
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
  type AttributeGuess,
  type AttributeSet,
  type CatchRecord,
  type ColorGuessRecord,
  type HuntClaim,
  type HuntItem,
  type RatingAxis,
  type TagRole,
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

/**
 * A team name that is actually a name. `.min(1)` alone accepts "   ", which
 * reaches the lobby as a blank row nobody can identify.
 */
const TEAM_NAME = z.string().max(40).transform((v) => v.trim()).pipe(z.string().min(1));

const CreateGameInput = z.object({
  hostUserId: z.string().min(1),
  tier: z.enum(['free', 'game_pack', 'unlimited']),
  config: GameConfigSchema,
  /** The league this game counts toward, already resolved from its code. */
  tournamentId: z.string().min(1).optional(),
  /**
   * How the host takes part. Hosting is not spectating by default: whoever sets
   * a game up is usually playing in it, and without this they were left
   * watching a game they had organised, unable to shoot anything. But somebody
   * running a game for a room full of other people is a real case too, so the
   * choice is theirs.
   *
   * Deliberately the same shape as `JoinInput.action`, minus `join_team` —
   * there is nothing to join yet when the game is being created.
   *
   * Optional: the solo daily hunt calls this directly and builds its own teams.
   */
  host: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('create_team'), name: TEAM_NAME }),
      z.object({ type: z.literal('judge') }),
      z.object({ type: z.literal('spectator') }),
    ])
    .optional(),
});

export async function createGame(
  repo: GameRepository,
  raw: unknown,
  now = Date.now,
): Promise<Result<{ gameId: string; code: string; teamId: string | null }>> {
  const parsed = CreateGameInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { hostUserId, tier, config, tournamentId, host } = parsed.data;

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

  // The host's own membership, created with the game rather than by a follow-up
  // join, so there is no window in which a game exists with its organiser
  // outside it.
  let hostTeamId: string | null = null;
  if (host !== undefined) {
    if (host.type === 'create_team') {
      hostTeamId = newId('team');
      game.teams.push({ id: hostTeamId, gameId: game.id, name: host.name, createdAt: now() });
    }
    game.memberships.push({
      id: newId('mem'),
      gameId: game.id,
      userId: hostUserId,
      teamId: hostTeamId,
      // Captain of their own team when playing. Running the game is tracked
      // separately by `hostUserId`, and that is what grants the power to start
      // it — a judge or spectator host keeps every host power.
      role: host.type === 'create_team' ? 'captain' : host.type,
      returnCheckins: {},
    });
  }

  const opened = applyTransition(game, { type: 'OPEN_LOBBY' });
  await repo.save(opened);
  return ok({ gameId: opened.id, code: opened.code, teamId: hostTeamId });
}

// --- joinByCode -------------------------------------------------------------

const JoinInput = z.object({
  code: z.string().min(1),
  userId: z.string().min(1),
  displayName: z.string().min(1),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('create_team'), name: TEAM_NAME }),
    z.object({ type: z.literal('join_team'), teamId: z.string().min(1) }),
    z.object({ type: z.literal('judge') }),
    z.object({ type: z.literal('spectator') }),
  ]),
  /**
   * Photo Tag only: acknowledgement that other players will photograph you
   * during play. Enforced here rather than shown and forgotten (docs/07).
   */
  acceptsBeingPhotographed: z.boolean().optional(),
});

export async function joinByCode(
  repo: GameRepository,
  raw: unknown,
): Promise<Result<{ gameId: string; teamId: string | null; role: string }>> {
  const parsed = JoinInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { code, userId, action, acceptsBeingPhotographed } = parsed.data;

  const game = await repo.getByCode(code);
  if (!game) return err('Game not found.');
  if (game.state !== 'lobby') return err('Game is not accepting joins.');
  if (game.memberships.some((m) => m.userId === userId)) return err('Already joined.');

  // Photo Tag photographs people who are trying not to be photographed, so the
  // acknowledgement is a server-side gate, not a screen you can scroll past.
  // Judges and spectators are exempt: they neither shoot nor are shot.
  const playing = action.type === 'create_team' || action.type === 'join_team';
  if (modeOf(game) === 'photo_tag' && playing && acceptsBeingPhotographed !== true) {
    return err('You must agree to being photographed by other players to join a tag game.');
  }

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

// --- Photo Tag ---------------------------------------------------------------

/** What one player knows about their own position in a tag round. */
export interface TagBriefView {
  teamId: string;
  subMode: Game['config']['tagSubMode'];
  /** Hide & Seek: your own role, hidden from you until the scatter ends. */
  role: TagRole | null;
  /** Dual: the team you hunt. You are never told who hunts you. */
  targetTeamId: string | null;
  targetTeamName: string | null;
  /**
   * Dual: whether someone hunting you is close. A boolean, never a distance
   * and never a name — naming the hunter lets the prey simply avoid one
   * person, which is the exploit this mode has to design around (docs/07).
   */
  hunterNearby: boolean;
}

/** The tag game and this caller's team, or an error explaining which is wrong. */
async function requireTagPlayer(
  repo: GameRepository,
  input: { gameId: string; userId: string },
): Promise<Result<{ game: Game; teamId: string }>> {
  const game = await repo.get(input.gameId);
  if (!game) return err('Game not found.');
  if (modeOf(game) !== 'photo_tag') return err('This game is not a tag game.');

  const membership = game.memberships.find((m) => m.userId === input.userId);
  if (!membership) return err('You are not in this game.');
  if (!membership.teamId) return err('Only players in the game can do that.');
  return ok({ game, teamId: membership.teamId });
}

/**
 * This caller's own tag brief.
 *
 * Scoped like every other secret in the app: your role, your prey, and a coarse
 * warning about anyone hunting you. Roles stay hidden through the scatter
 * window — that is what `scatter` is for — and the hunter is never named.
 */
export async function getTagBrief(
  repo: GameRepository,
  input: { gameId: string; userId: string },
): Promise<Result<TagBriefView>> {
  const found = await requireTagPlayer(repo, input);
  if (!found.ok) return found;
  const { game, teamId } = found.data;

  const tag = game.tag;
  const revealed = game.state !== 'scatter';
  const targetTeamId = revealed ? (tag?.targets?.[teamId] ?? null) : null;

  // The warning is computed from the hunter's ping but never reveals whose it
  // is; only the boolean crosses the boundary.
  const hunterTeamId = Object.entries(tag?.targets ?? {}).find(([, prey]) => prey === teamId)?.[0];
  const hunterNearby =
    revealed && hunterTeamId !== undefined
      ? isHunterNearby(tag?.pings?.[teamId], tag?.pings?.[hunterTeamId])
      : false;

  return ok({
    teamId,
    subMode: game.config.tagSubMode ?? 'pure_finder',
    role: revealed ? (tag?.roles?.[teamId] ?? null) : null,
    targetTeamId,
    targetTeamName: targetTeamId ? (game.teams.find((t) => t.id === targetTeamId)?.name ?? null) : null,
    hunterNearby,
  });
}

const PingInput = z.object({
  gameId: z.string().min(1),
  userId: z.string().min(1),
  location: z.object({ lat: z.number(), lng: z.number(), accuracyM: z.number().optional() }),
});

/**
 * Report this player's position, used only to compute the proximity warning.
 *
 * The ping is never returned to another player — the only thing derived from it
 * that anyone else sees is a boolean about their own situation.
 */
export async function reportTagPing(
  repo: GameRepository,
  raw: unknown,
  now = Date.now,
): Promise<Result<{ at: number }>> {
  const parsed = PingInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');

  const found = await requireTagPlayer(repo, parsed.data);
  if (!found.ok) return found;
  const { game, teamId } = found.data;
  if (game.state !== 'tag_active') return err('The round is not running.');

  const tag = game.tag ?? (game.tag = { subMode: game.config.tagSubMode ?? 'pure_finder', catches: [] });
  const at = now();
  tag.pings = { ...(tag.pings ?? {}), [teamId]: { ...parsed.data.location, at } };
  await repo.save(game);
  return ok({ at });
}

const ClaimCatchInput = z.object({
  gameId: z.string().min(1),
  hunterUserId: z.string().min(1),
  targetTeamId: z.string().min(1),
  photoId: z.string().min(1),
});

/**
 * Claim a catch. Nothing is scored yet: the photo goes to the target's own
 * phone for confirmation, because doc 07 permits face detection and forbids
 * face recognition — no system here can answer "is this person X".
 */
export async function claimCatch(
  repo: GameRepository,
  raw: unknown,
  now = Date.now,
): Promise<Result<{ catchId: string; status: CatchRecord['status'] }>> {
  const parsed = ClaimCatchInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { gameId, hunterUserId, targetTeamId, photoId } = parsed.data;

  const found = await requireTagPlayer(repo, { gameId, userId: hunterUserId });
  if (!found.ok) return found;
  const { game, teamId } = found.data;
  if (game.state !== 'tag_active') return err('The round is not running.');
  if (teamId === targetTeamId) return err('You cannot catch yourself.');
  if (!game.teams.some((t) => t.id === targetTeamId)) return err('Player not found.');

  const photo = game.photos.find((p) => p.id === photoId);
  if (!photo) return err('Photo not found.');
  if (photo.teamId !== teamId) return err('That is not your photo.');

  const tag = game.tag ?? (game.tag = { subMode: game.config.tagSubMode ?? 'pure_finder', catches: [] });
  const record: CatchRecord = {
    id: newId('catch'),
    hunterTeamId: teamId,
    targetTeamId,
    photoId,
    claimedAt: now(),
    status: 'pending',
  };
  tag.catches.push(record);
  await repo.save(game);
  return ok({ catchId: record.id, status: record.status });
}

/** A claim awaiting this caller's ruling: "you've been caught — were you?" */
export interface CatchClaimView {
  catchId: string;
  hunterTeamName: string;
  /** The photo being claimed; exchange for a URL via /downloads. */
  photoKey: string;
  claimedAt: number;
  status: CatchRecord['status'];
}

/**
 * Claims made against this caller's team. The photo is shown so they can judge
 * it themselves — that peer check is the whole verification mechanism.
 */
export async function listCatchClaims(
  repo: GameRepository,
  input: { gameId: string; userId: string },
): Promise<Result<CatchClaimView[]>> {
  const found = await requireTagPlayer(repo, input);
  if (!found.ok) return found;
  const { game, teamId } = found.data;

  const nameOf = (id: string) => game.teams.find((t) => t.id === id)?.name ?? id;
  const keyOf = (id: string) => game.photos.find((p) => p.id === id)?.s3Key ?? '';

  return ok(
    (game.tag?.catches ?? [])
      .filter((c) => c.targetTeamId === teamId)
      .sort((a, b) => a.claimedAt - b.claimedAt)
      .map((c) => ({
        catchId: c.id,
        hunterTeamName: nameOf(c.hunterTeamId),
        photoKey: keyOf(c.photoId),
        claimedAt: c.claimedAt,
        status: c.status,
      })),
  );
}

const AnswerCatchInput = z.object({
  gameId: z.string().min(1),
  userId: z.string().min(1),
  catchId: z.string().min(1),
  confirm: z.boolean(),
});

/** Confirm or dispute a claim made against you. Only the target may answer. */
export async function answerCatchClaim(
  repo: GameRepository,
  raw: unknown,
): Promise<Result<{ status: CatchRecord['status'] }>> {
  const parsed = AnswerCatchInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { gameId, userId, catchId, confirm } = parsed.data;

  const found = await requireTagPlayer(repo, { gameId, userId });
  if (!found.ok) return found;
  const { game, teamId } = found.data;

  const record = game.tag?.catches.find((c) => c.id === catchId);
  if (!record) return err('Claim not found.');
  if (record.targetTeamId !== teamId) return err('Only the player claimed can answer.');
  if (record.status === 'overruled') return err('The host has already ruled on this claim.');

  record.status = confirm ? 'confirmed' : 'disputed';
  await repo.save(game);
  return ok({ status: record.status });
}

const ResolveDisputeInput = z.object({
  gameId: z.string().min(1),
  hostUserId: z.string().min(1),
  catchId: z.string().min(1),
  uphold: z.boolean(),
});

/**
 * Host ruling on a disputed claim. The host is the backstop precisely because
 * nothing automated can settle it — and `overruled` is final, so a player
 * cannot answer their way out of a decision that went against them.
 */
export async function resolveCatchDispute(
  repo: GameRepository,
  raw: unknown,
): Promise<Result<{ status: CatchRecord['status'] }>> {
  const parsed = ResolveDisputeInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { gameId, hostUserId, catchId, uphold } = parsed.data;

  const found = await requireHost(repo, gameId, hostUserId);
  if (!found.ok) return found;
  const game = found.data;
  if (modeOf(game) !== 'photo_tag') return err('This game is not a tag game.');

  const record = game.tag?.catches.find((c) => c.id === catchId);
  if (!record) return err('Claim not found.');
  if (record.status !== 'disputed') return err('Only a disputed claim needs a ruling.');

  record.status = uphold ? 'confirmed' : 'overruled';
  await repo.save(game);
  return ok({ status: record.status });
}

// --- Colour Hunt: secrets and guessing --------------------------------------

/** The caller's own team's secret, and how specific the guess has to be. */
export interface MySecretView {
  teamId: string;
  secret: AttributeSet;
  /** Rendered form, for the brief and for the reveal. */
  description: string;
}

/**
 * The caller team's secret attribute set.
 *
 * Scoped exactly like {@link listAssignments}: a player can only ever read
 * their own team's secret, because reading someone else's *is* the game. Judges
 * and spectators have no team and so have no secret to read.
 */
export async function getMySecret(
  repo: GameRepository,
  input: { gameId: string; userId: string },
): Promise<Result<MySecretView>> {
  const game = await repo.get(input.gameId);
  if (!game) return err('Game not found.');
  if (modeOf(game) !== 'color_hunt') return err('This game is not a colour hunt.');

  const membership = game.memberships.find((m) => m.userId === input.userId);
  if (!membership) return err('You are not in this game.');
  if (!membership.teamId) return err('Only players on a team have a secret.');

  const secret = game.color?.secrets[membership.teamId];
  if (!secret) return err('Secrets have not been dealt yet.');
  return ok({ teamId: membership.teamId, secret, description: describeAttributeSet(secret) });
}

/** Another team's photo set, as the caller studies it before guessing. */
export interface GuessTargetView {
  teamId: string;
  teamName: string;
  /** S3 keys of that team's photos; exchange for URLs via /downloads. */
  photoKeys: string[];
  /** This team's committed guess so far, if any. */
  myGuess: AttributeGuess | null;
}

/**
 * The teams the caller may guess about, with the photos to study.
 *
 * Own team is excluded — you already know your own secret — and no secret is
 * ever included, only the photos. Available during the guessing window and
 * afterwards, so the results screen can show what was studied.
 */
export async function listGuessTargets(
  repo: GameRepository,
  input: { gameId: string; userId: string },
): Promise<Result<GuessTargetView[]>> {
  const game = await repo.get(input.gameId);
  if (!game) return err('Game not found.');
  if (modeOf(game) !== 'color_hunt') return err('This game is not a colour hunt.');

  const membership = game.memberships.find((m) => m.userId === input.userId);
  if (!membership) return err('You are not in this game.');

  const mine = membership.teamId;
  const targets = game.teams
    .filter((team) => team.id !== mine)
    .map((team): GuessTargetView => ({
      teamId: team.id,
      teamName: team.name,
      photoKeys: game.photos
        .filter((p) => p.teamId === team.id)
        .sort((a, b) => a.order - b.order)
        .map((p) => p.s3Key),
      myGuess:
        (mine &&
          game.color?.guesses.find((g) => g.guesserTeamId === mine && g.subjectTeamId === team.id)?.guess) ||
        null,
    }));
  return ok(targets);
}

const SubmitGuessInput = z.object({
  gameId: z.string().min(1),
  userId: z.string().min(1),
  subjectTeamId: z.string().min(1),
  guess: z.object({
    color: z.enum(COLORS).optional(),
    shape: z.enum(SHAPES).optional(),
    motif: z.enum(MOTIFS).optional(),
  }),
});

/**
 * Commit (or change) this team's guess about another team's secret.
 *
 * Replaceable while the window is open, so a team can revise as they study —
 * the guess is only locked when the host closes guessing, which is what
 * `CLOSE_GUESSING` means.
 */
export async function submitGuess(
  repo: GameRepository,
  raw: unknown,
): Promise<Result<{ subjectTeamId: string; guess: AttributeGuess }>> {
  const parsed = SubmitGuessInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { gameId, userId, subjectTeamId, guess } = parsed.data;

  const game = await repo.get(gameId);
  if (!game) return err('Game not found.');
  if (modeOf(game) !== 'color_hunt') return err('This game is not a colour hunt.');
  if (game.state !== 'guessing') return err('The guessing window is not open.');

  const membership = game.memberships.find((m) => m.userId === userId);
  if (!membership) return err('You are not in this game.');
  if (!membership.teamId) return err('Only players on a team guess.');
  if (membership.teamId === subjectTeamId) return err('You already know your own secret.');
  if (!game.teams.some((t) => t.id === subjectTeamId)) return err('Team not found.');

  const color = game.color ?? (game.color = { secrets: {}, guesses: [] });
  const record: ColorGuessRecord = { guesserTeamId: membership.teamId, subjectTeamId, guess };
  const existing = color.guesses.findIndex(
    (g) => g.guesserTeamId === membership.teamId && g.subjectTeamId === subjectTeamId,
  );
  if (existing >= 0) color.guesses[existing] = record;
  else color.guesses.push(record);

  await repo.save(game);
  return ok({ subjectTeamId, guess });
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

  // Colour Hunt: once guessing has closed the secrets are public, so judging is
  // "does this photo really contain what that team was hiding?". Without that
  // check the winning strategy is to omit the attribute, which is unguessable.
  if (modeOf(game) === 'color_hunt') {
    const claims = game.photos
      .filter((p) => game.color?.secrets[p.teamId] !== undefined)
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
        itemId: p.teamId,
        itemLabel: describeAttributeSet(game.color!.secrets[p.teamId]!),
      }));
    return ok(claims);
  }

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

/**
 * Deal each team its secret attribute set. Done at start rather than creation
 * because the teams are not known until then, and seeded from the game's code
 * so a game is reproducible.
 */
function assignColorSecrets(game: Game): void {
  if (modeOf(game) !== 'color_hunt' || game.color) return;
  game.color = {
    secrets: assignAttributeSets({
      teamIds: game.teams.map((t) => t.id),
      specificity: game.config.colorSpecificity ?? 'simple',
      seed: seedFromCode(game.code),
    }),
    guesses: [],
  };
}

/**
 * Deal tag roles and targets at start. Held on the aggregate through the
 * scatter window and only revealed to each player once it ends — the point of
 * `scatter` is that nobody yet knows who they are.
 */
function assignTagState(game: Game): void {
  if (modeOf(game) !== 'photo_tag' || game.tag) return;
  const subMode = game.config.tagSubMode ?? 'pure_finder';
  game.tag = {
    subMode,
    ...assignTagRoles({ teamIds: game.teams.map((t) => t.id), subMode, seed: seedFromCode(game.code) }),
    catches: [],
  };
}

export async function startGame(
  repo: GameRepository,
  input: { gameId: string; hostUserId: string },
): Promise<Result<{ state: Game['state'] }>> {
  const found = await requireHost(repo, input.gameId, input.hostUserId);
  if (!found.ok) return found;
  try {
    const started = applyTransition(found.data, { type: 'START_GAME' });
    assignColorSecrets(started);
    assignTagState(started);
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
  // A tag photo is shot live during the round rather than in a capture phase.
  const shootingState = modeOf(game) === 'photo_tag' ? 'tag_active' : 'round1_active';
  if (game.state !== shootingState) return err('Not in a shooting phase.');

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
  // Tag has no quota at all — you shoot whenever you can get the shot.
  const quota = isHunt
    ? (game.hunt?.items.length ?? 0)
    : modeOf(game) === 'photo_tag'
      ? Number.POSITIVE_INFINITY
      : game.config.photosPerRound;
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

  const mode = modeOf(game);
  if (mode === 'scavenger_hunt' || mode === 'color_hunt') {
    // Both judge a photo against a stated claim, so both use one axis and
    // reject the chase's two — a stray vote must not land in a column this
    // mode's scorer never reads.
    if (axis !== 'validity') return err('This mode is rated on validity.');
    const photo = game.photos.find((p) => p.id === assignmentId);
    if (!photo) return err('Photo not found.');
    if (mode === 'scavenger_hunt' && photo.itemId === undefined) return err('Claim not found.');
    if (!isJudge && voter.teamId === photo.teamId) return err("Cannot rate your own team's photo.");
  } else {
    if (axis === 'validity') return err('Validity does not apply to a chase.');
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

  if (modeOf(game) === 'photo_tag') {
    const tagFouls: Record<string, number> = {};
    for (const p of game.photos) {
      if (p.fouls.length > 0) tagFouls[p.teamId] = (tagFouls[p.teamId] ?? 0) + p.fouls.length;
    }
    return ok({
      scoreboard: scoreTag({
        teamIds,
        subMode: game.tag?.subMode ?? 'pure_finder',
        catches: game.tag?.catches ?? [],
        ...(game.tag?.roles ? { roles: game.tag.roles } : {}),
        ...(game.tag?.targets ? { targets: game.tag.targets } : {}),
        fouls: tagFouls,
        bestMatchTeamId: finals.bestMatchTeamId,
        specialWinners: finals.specialWinners,
      }),
    });
  }

  if (modeOf(game) === 'color_hunt') {
    // A team is confirmed unless its photos were voted down — same "unjudged
    // counts" rule the hunt uses, for the same reason: most games have nobody
    // moderating, and defaulting to void would gut the mode rather than police
    // it. A team that never showed its attribute keeps no bluff bonus.
    const confirmed: Record<string, boolean> = {};
    for (const team of game.teams) {
      const photoIds = new Set(game.photos.filter((p) => p.teamId === team.id).map((p) => p.id));
      const votes = game.votes.filter((v) => v.axis === 'validity' && photoIds.has(v.assignmentId));
      const weight = votes.reduce((sum, v) => sum + weightOf(v.voterUserId), 0);
      const stars = votes.reduce((sum, v) => sum + v.stars * weightOf(v.voterUserId), 0);
      const disputed = game.photos.some((p) => p.teamId === team.id && p.fouls.includes('missing_item'));
      confirmed[team.id] = !disputed && (weight === 0 || stars / weight >= VALIDITY_THRESHOLD);
    }

    const colorFouls: Record<string, number> = {};
    for (const p of game.photos) {
      // As in the hunt: `missing_item` already voids the bluff, so charging a
      // penalty on top would be double jeopardy.
      const counted = p.fouls.filter((f) => f !== 'missing_item').length;
      if (counted > 0) colorFouls[p.teamId] = (colorFouls[p.teamId] ?? 0) + counted;
    }

    return ok({
      scoreboard: scoreColorHunt({
        teamIds,
        secrets: game.color?.secrets ?? {},
        guesses: game.color?.guesses ?? [],
        confirmed,
        fouls: colorFouls,
        bestMatchTeamId: finals.bestMatchTeamId,
        specialWinners: finals.specialWinners,
      }),
    });
  }

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
