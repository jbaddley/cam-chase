import type {
  AttributeGuess,
  AttributeSet,
  Flair,
  FoulReason,
  GameConfig,
  GameEvent,
  GameMode,
  GameState,
  RatingAxis,
  Standing,
  TeamScore,
  Tier,
  TierLimits,
} from '@photochase/shared';
import { request, type ClientConfig } from './http.js';

/** Sanitized game view returned by `GET /games/:id`, safe for any player. */
export interface GameStateView {
  id: string;
  code: string;
  state: GameState;
  config: GameConfig;
  teams: TeamSummary[];
  playerCount: number;
  /** The tier this lobby plays at — the host's, since only theirs gates a game. */
  hostTier: Tier;
}

/** The caller's invite code and what it has earned them. */
export interface ReferralView {
  code: string;
  inviteUrl: string;
  /** Invitees who installed *and* played a game through to the end. */
  creditedReferrals: number;
  modesEarned: GameMode[];
  nextUnlock: { mode: GameMode; referralsAway: number } | null;
  flair: Flair | null;
}

/** The caller team's secret attribute set in a colour hunt. */
export interface MySecretView {
  teamId: string;
  secret: AttributeSet;
  /** Rendered form, for the brief and for the reveal. */
  description: string;
}

/** Another team's photo set, as the caller studies it before guessing. */
export interface GuessTargetView {
  teamId: string;
  teamName: string;
  /** S3 keys of that team's photos; exchange for URLs via requestDownload. */
  photoKeys: string[];
  /** This team's committed guess so far, if any. */
  myGuess: AttributeGuess | null;
}

/** A league table: the season's name, code, and standings. */
export interface StandingsView {
  tournamentId: string;
  code: string;
  name: string;
  gamesPlayed: number;
  standings: Standing[];
}

/** A shareable comparison card, produced only once everyone depicted agreed. */
export interface ShareCardView {
  gameId: string;
  originalRef: string;
  chaseRef: string;
  originalTeamName: string;
  chaseTeamName: string;
  scoreStamp: string;
  shareUrl: string;
  status: 'active' | 'taken_down';
}

/** A location fix attached to a captured photo. */
export interface GeoPointInput {
  lat: number;
  lng: number;
  accuracyM?: number;
}

/** How a player enters a game's lobby. Mirrors the server's join actions. */
export type JoinAction =
  | { type: 'create_team'; name: string }
  | { type: 'join_team'; teamId: string }
  | { type: 'judge' }
  | { type: 'spectator' };

export interface JoinGameInput {
  code: string;
  displayName: string;
  action: JoinAction;
}

/** One Round 2 task in the caller team's queue. */
export interface AssignmentView {
  assignmentId: string;
  order: number;
  originalPhotoId: string;
  /** S3 key of the photo to recreate; exchange for a URL via requestDownload. */
  originalPhotoKey: string;
  /** Set once this team has submitted its chase. */
  chasePhotoId: string | null;
}

/**
 * One thing the caller may rate: a chase attempt paired with the original it
 * recreates, or — in a scavenger hunt, which has no originals — the claim photo
 * itself, with `itemLabel` naming what it is judged against.
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

/** One item on a scavenger hunt list, with the caller's team's progress. */
export interface HuntItemView {
  itemId: string;
  label: string;
  rarity: 'common' | 'rare';
  /** The mid-round wildcard, which pays double. */
  wildcard: boolean;
  /** The caller's team's photo claiming this item, once one is submitted. */
  claimedPhotoId: string | null;
}

export interface HuntView {
  items: HuntItemView[];
  /** When the wildcard drops, for a countdown. The item stays hidden until then. */
  wildcardRevealAt: number | null;
}

/** Finals categories open for voting, plus this caller's picks so far. */
export interface FinalsView {
  categories: Array<{ id: string; label: string }>;
  teams: Array<{ teamId: string; name: string }>;
  /** category id → teamId this user voted for. */
  myVotes: Record<string, string>;
}

/** What a big-screen viewer sees: the public game view plus final standings. */
export interface SpectatorView {
  game: GameStateView;
  /** Present once the game has reached a scorable phase. */
  scoreboard: TeamScore[] | null;
}

/** The caller's monetization entitlement, for rendering paywalls and limits. */
export interface EntitlementView {
  tier: Tier;
  gameCredits: number;
  subscriptionActive: boolean;
  subscriptionExpiresAt?: number;
  canStartGame: boolean;
  cannotStartReason?: string;
  limits: TierLimits;
  /** Modes this user may host: the tier's, plus any earned by referral. */
  modes: GameMode[];
  features: Record<string, boolean>;
}

/** A team summary for the lobby list. */
export interface TeamSummary {
  teamId: string;
  name: string;
  memberCount: number;
}

/**
 * The presigned S3 POST returned by the upload endpoint. `fields` must be sent
 * as-is (order matters), with the file appended last.
 */
export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
}

export interface UploadTarget {
  objectId: string;
  key: string;
  upload: PresignedPost;
}

/**
 * Typed client for the PhotoChase API. The caller's identity is carried by the
 * auth token (see {@link ClientConfig.getToken}) — request bodies never include
 * a user id.
 */
export class PhotoChaseClient {
  constructor(private readonly config: ClientConfig) {}

  // --- game lifecycle -------------------------------------------------------

  /** Create a game, optionally playing it into a league you hold the code for. */
  createGame(config: GameConfig, tournamentCode?: string): Promise<{ gameId: string; code: string }> {
    return request(this.config, 'POST', '/games', { config, ...(tournamentCode ? { tournamentCode } : {}) });
  }

  joinGame(input: JoinGameInput): Promise<{ gameId: string; teamId: string | null; role: string }> {
    return request(this.config, 'POST', '/games/join', input);
  }

  listTeams(gameId: string): Promise<TeamSummary[]> {
    return request(this.config, 'GET', `/games/${encodeURIComponent(gameId)}/teams`);
  }

  getGame(gameId: string): Promise<GameStateView> {
    return request(this.config, 'GET', `/games/${encodeURIComponent(gameId)}`);
  }

  /**
   * Look up a game by join code for the big-screen view. Needs no auth token,
   * so it works from a TV browser where nobody is signed in.
   */
  spectate(code: string): Promise<SpectatorView> {
    return request(this.config, 'GET', `/spectate/${encodeURIComponent(code)}`);
  }

  startGame(gameId: string): Promise<{ state: GameState }> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/start`);
  }

  advanceGame(gameId: string, event: GameEvent['type']): Promise<{ state: GameState }> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/advance`, { event });
  }

  // --- gameplay writes ------------------------------------------------------

  submitPhoto(
    gameId: string,
    input: { teamId: string; location: GeoPointInput; s3Key: string; itemId?: string },
  ): Promise<{ photoId: string }> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/photos`, input);
  }

  submitChase(
    gameId: string,
    input: { assignmentId: string; location: GeoPointInput; s3Key: string },
  ): Promise<{ chasePhotoId: string }> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/chases`, input);
  }

  castVote(
    gameId: string,
    input: { assignmentId: string; axis: RatingAxis; stars: number },
  ): Promise<{ voteId: string }> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/votes`, input);
  }

  /** Call a foul on another team's photo. Returns the photo's fouls after. */
  flagFoul(gameId: string, photoId: string, input: { reason: FoulReason }): Promise<{ fouls: FoulReason[] }> {
    return request(this.config, 'POST', this.foulPath(gameId, photoId), input);
  }

  /** Withdraw a foul. Returns the photo's fouls after. */
  clearFoul(gameId: string, photoId: string, input: { reason: FoulReason }): Promise<{ fouls: FoulReason[] }> {
    return request(this.config, 'DELETE', this.foulPath(gameId, photoId), input);
  }

  private foulPath(gameId: string, photoId: string): string {
    return `/games/${encodeURIComponent(gameId)}/photos/${encodeURIComponent(photoId)}/fouls`;
  }

  /** The caller's own tier, credits, limits, and feature flags. */
  getEntitlement(): Promise<EntitlementView> {
    return request(this.config, 'GET', '/me/entitlement');
  }

  /** The caller's invite code, progress toward the next unlock, and flair. */
  getReferral(): Promise<ReferralView> {
    return request(this.config, 'GET', '/me/referral');
  }

  /** Redeem someone's invite code. Credits nothing until this user finishes a game. */
  redeemReferral(code: string): Promise<{ attributed: boolean; reason?: string }> {
    return request(this.config, 'POST', '/me/referral/redeem', { code });
  }

  /** Agree (or refuse) that this caller's photos may appear on a share card. */
  setSharingConsent(gameId: string, consent: boolean): Promise<{ consent: boolean }> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/consent`, { consent });
  }

  /**
   * Build a share card for one comparison. Fails while anyone depicted has not
   * consented — the server decides who that is, not the caller.
   */
  createShareCard(
    gameId: string,
    input: { originalPhotoId: string; chasePhotoId: string; scoreStamp: string },
  ): Promise<ShareCardView> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/share-cards`, input);
  }

  /** Check the caller's team in at the return spot during a return phase. */
  checkIn(gameId: string, input: { location: GeoPointInput }): Promise<{ round: string; at: number }> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/checkins`, input);
  }

  /** The caller team's Round 2 queue, in delivery order. */
  listAssignments(gameId: string): Promise<AssignmentView[]> {
    return request(this.config, 'GET', `/games/${encodeURIComponent(gameId)}/assignments`);
  }

  /** The caller team's own secret. Never anyone else's — reading those is the game. */
  getMySecret(gameId: string): Promise<MySecretView> {
    return request(this.config, 'GET', `/games/${encodeURIComponent(gameId)}/secret`);
  }

  /** The teams the caller may guess about, with the photos to study. */
  listGuessTargets(gameId: string): Promise<GuessTargetView[]> {
    return request(this.config, 'GET', `/games/${encodeURIComponent(gameId)}/guess-targets`);
  }

  /** Commit or revise this team's guess about another team's secret. */
  submitGuess(
    gameId: string,
    input: { subjectTeamId: string; guess: AttributeGuess },
  ): Promise<{ subjectTeamId: string; guess: AttributeGuess }> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/guesses`, input);
  }

  /** The scavenger hunt list, with this team's progress and the wildcard timer. */
  listHuntItems(gameId: string): Promise<HuntView> {
    return request(this.config, 'GET', `/games/${encodeURIComponent(gameId)}/items`);
  }

  /** The chases the caller may rate, with any votes they've already cast. */
  listRateable(gameId: string): Promise<RateableView[]> {
    return request(this.config, 'GET', `/games/${encodeURIComponent(gameId)}/rateable`);
  }

  /** Finals categories and the caller's existing picks. */
  getFinals(gameId: string): Promise<FinalsView> {
    return request(this.config, 'GET', `/games/${encodeURIComponent(gameId)}/finals`);
  }

  /** Cast or change this caller's finals vote in one category. */
  castFinalsVote(
    gameId: string,
    input: { category: string; teamId: string },
  ): Promise<{ category: string; teamId: string }> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/finals`, input);
  }

  getResults(gameId: string): Promise<{ scoreboard: TeamScore[] }> {
    return request(this.config, 'GET', `/games/${encodeURIComponent(gameId)}/results`);
  }

  /** A short written recap of a finished game, for sharing and the big screen. */
  getRecap(gameId: string): Promise<{ recap: string }> {
    return request(this.config, 'GET', `/games/${encodeURIComponent(gameId)}/recap`);
  }

  // --- leagues --------------------------------------------------------------

  /** Start a league season. Paid only; joining someone else's is always free. */
  createTournament(name: string): Promise<{ tournamentId: string; code: string }> {
    return request(this.config, 'POST', '/tournaments', { name });
  }

  /** A league's table, resolved by the code it is shared by. */
  getStandings(code: string): Promise<StandingsView> {
    return request(this.config, 'GET', `/tournaments/${encodeURIComponent(code)}/standings`);
  }

  // --- media ----------------------------------------------------------------

  requestUpload(gameId: string, teamId: string): Promise<UploadTarget> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/uploads`, { teamId });
  }

  requestDownload(gameId: string, photoId: string): Promise<{ url: string }> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/downloads`, { photoId });
  }

  /**
   * Upload a photo directly to S3 using a presigned POST. The form fields are
   * sent first, then the file — S3 rejects the request if `file` precedes them.
   * Bypasses {@link request} because the response is empty (204) and not JSON.
   */
  async uploadPhoto(post: PresignedPost, file: Blob): Promise<void> {
    const form = new FormData();
    for (const [name, value] of Object.entries(post.fields)) form.append(name, value);
    form.append('file', file);

    const doFetch = this.config.fetch ?? (globalThis.fetch as typeof fetch);
    const res = await doFetch(post.url, { method: 'POST', body: form });
    if (!res.ok) {
      throw new Error(`Photo upload failed with status ${res.status}`);
    }
  }

  /**
   * Capture a Round 1 photo end to end: request a presigned target, upload the
   * file to S3, then register the photo's metadata. The S3 key minted by the
   * upload step is what gets submitted, so the record points at the real object.
   */
  async capturePhoto(
    gameId: string,
    input: { teamId: string; location: GeoPointInput; file: Blob; itemId?: string },
  ): Promise<{ photoId: string; key: string }> {
    const target = await this.requestUpload(gameId, input.teamId);
    await this.uploadPhoto(target.upload, input.file);
    const { photoId } = await this.submitPhoto(gameId, {
      teamId: input.teamId,
      location: input.location,
      s3Key: target.key,
      ...(input.itemId ? { itemId: input.itemId } : {}),
    });
    return { photoId, key: target.key };
  }

  /**
   * Capture a Round 2 chase end to end, mirroring {@link capturePhoto} but
   * registering the result against the assignment being chased.
   */
  async captureChase(
    gameId: string,
    input: { teamId: string; assignmentId: string; location: GeoPointInput; file: Blob },
  ): Promise<{ chasePhotoId: string; key: string }> {
    const target = await this.requestUpload(gameId, input.teamId);
    await this.uploadPhoto(target.upload, input.file);
    const { chasePhotoId } = await this.submitChase(gameId, {
      assignmentId: input.assignmentId,
      location: input.location,
      s3Key: target.key,
    });
    return { chasePhotoId, key: target.key };
  }
}
