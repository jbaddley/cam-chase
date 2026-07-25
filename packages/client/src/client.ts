import type { GameConfig, GameEvent, GameState, TeamScore } from '@photochase/shared';
import { request, type ClientConfig } from './http.js';

/** Sanitized game view returned by `GET /games/:id`, safe for any player. */
export interface GameStateView {
  id: string;
  code: string;
  state: GameState;
  config: GameConfig;
  teams: TeamSummary[];
  playerCount: number;
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

/** A chase attempt the caller may rate, paired with the original it recreates. */
export interface RateableView {
  assignmentId: string;
  originalPhotoId: string;
  originalPhotoKey: string;
  chasePhotoId: string;
  chasePhotoKey: string;
  /** Stars this user has already given on each axis, if any. */
  myVotes: { pose: number | null; angle: number | null };
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

  createGame(config: GameConfig): Promise<{ gameId: string; code: string }> {
    return request(this.config, 'POST', '/games', { config });
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

  startGame(gameId: string): Promise<{ state: GameState }> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/start`);
  }

  advanceGame(gameId: string, event: GameEvent['type']): Promise<{ state: GameState }> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/advance`, { event });
  }

  // --- gameplay writes ------------------------------------------------------

  submitPhoto(
    gameId: string,
    input: { teamId: string; location: GeoPointInput; s3Key: string },
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
    input: { assignmentId: string; axis: 'pose' | 'angle'; stars: number },
  ): Promise<{ voteId: string }> {
    return request(this.config, 'POST', `/games/${encodeURIComponent(gameId)}/votes`, input);
  }

  /** The caller team's Round 2 queue, in delivery order. */
  listAssignments(gameId: string): Promise<AssignmentView[]> {
    return request(this.config, 'GET', `/games/${encodeURIComponent(gameId)}/assignments`);
  }

  /** The chases the caller may rate, with any votes they've already cast. */
  listRateable(gameId: string): Promise<RateableView[]> {
    return request(this.config, 'GET', `/games/${encodeURIComponent(gameId)}/rateable`);
  }

  getResults(gameId: string): Promise<{ scoreboard: TeamScore[] }> {
    return request(this.config, 'GET', `/games/${encodeURIComponent(gameId)}/results`);
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
    input: { teamId: string; location: GeoPointInput; file: Blob },
  ): Promise<{ photoId: string; key: string }> {
    const target = await this.requestUpload(gameId, input.teamId);
    await this.uploadPhoto(target.upload, input.file);
    const { photoId } = await this.submitPhoto(gameId, {
      teamId: input.teamId,
      location: input.location,
      s3Key: target.key,
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
