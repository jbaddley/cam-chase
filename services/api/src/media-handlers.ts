import type { PresignedPost } from '@aws-sdk/s3-presigned-post';
import type { Result } from './handlers.js';
import { newId } from './ids.js';
import { photoKey, type MediaService } from './media.js';
import type { GameRepository } from './repository.js';

const err = (error: string): Result<never> => ({ ok: false, error });
const ok = <T>(data: T): Result<T> => ({ ok: true, data });

const ROUND_STATES = new Set(['round1_active', 'round2_active']);

/**
 * Issue a presigned upload for a team photo. Allowed only during a round, and
 * only to a member of the team. Returns the object key (to pass to
 * submitPhoto/submitChase after the upload succeeds) and the presigned POST.
 */
export async function requestPhotoUpload(
  gameRepo: GameRepository,
  media: MediaService,
  input: { gameId: string; teamId: string; userId: string },
): Promise<Result<{ objectId: string; key: string; upload: PresignedPost }>> {
  const game = await gameRepo.get(input.gameId);
  if (!game) return err('Game not found.');
  if (!ROUND_STATES.has(game.state)) return err('Photos can only be uploaded during a round.');
  const isMember = game.memberships.some((m) => m.userId === input.userId && m.teamId === input.teamId);
  if (!isMember) return err('You are not a member of that team.');

  const objectId = newId('obj');
  const key = photoKey(input.gameId, input.teamId, objectId);
  const upload = await media.createUploadPost(key);
  return ok({ objectId, key, upload });
}

/**
 * Issue a presigned download URL for a photo. Allowed only to a participant in
 * the game (any membership, including judges/spectators).
 */
export async function requestPhotoDownload(
  gameRepo: GameRepository,
  media: MediaService,
  input: { gameId: string; photoId: string; userId: string },
): Promise<Result<{ url: string }>> {
  const game = await gameRepo.get(input.gameId);
  if (!game) return err('Game not found.');
  const inGame = game.memberships.some((m) => m.userId === input.userId);
  if (!inGame) return err('You are not in this game.');
  const photo = game.photos.find((p) => p.id === input.photoId);
  if (!photo) return err('Photo not found.');

  const url = await media.createDownloadUrl(photo.s3Key);
  return ok({ url });
}
