import type { GameConfig, GameEvent, GameState, TeamScore } from '@photochase/shared';
import { request, type ClientConfig } from './http.js';

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
}
