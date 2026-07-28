import type { PresignedPost } from '@aws-sdk/s3-presigned-post';
import type { Result } from './handlers.js';
import { newId } from './ids.js';
import { thumbnailKey } from './image.js';
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

/** Phases where every participant may see every photo — judging needs it. */
const OPEN_STATES = new Set(['rating', 'finals_voting', 'results', 'archived']);

/**
 * Issue a presigned download URL for a photo.
 *
 * Being in the game used to be the whole permission, which was harmless while
 * nothing in the app downloaded anything. Round 2 makes this a hot path, and
 * what it guards is that round's only secret: which photo your team was given to
 * recreate. So mid-round the answer is your own team's photos and the originals
 * you were assigned, and nothing else. From rating onward the scoping lifts
 * entirely — comparing every pair *is* the phase — rather than being carved out
 * per role, which is also why a judge is refused before then: there is nothing
 * to judge yet.
 *
 * `variant: 'thumb'` signs the 1024px derivative instead of the original. The
 * caller should fall back to the original on error: the thumbnail is written by
 * an S3-triggered Lambda, so for a photo taken seconds ago it may not exist.
 */
export async function requestPhotoDownload(
  gameRepo: GameRepository,
  media: MediaService,
  input: { gameId: string; photoId: string; userId: string; variant?: 'thumb' },
): Promise<Result<{ url: string }>> {
  const game = await gameRepo.get(input.gameId);
  if (!game) return err('Game not found.');
  const membership = game.memberships.find((m) => m.userId === input.userId);
  if (!membership) return err('You are not in this game.');
  const photo = game.photos.find((p) => p.id === input.photoId);
  if (!photo) return err('Photo not found.');

  const ownPhoto = membership.teamId !== null && photo.teamId === membership.teamId;
  const assignedToChase =
    membership.teamId !== null &&
    game.assignments.some((a) => a.chaserTeamId === membership.teamId && a.originalPhotoId === photo.id);
  if (!OPEN_STATES.has(game.state) && !ownPhoto && !assignedToChase) {
    return err('That photo is not yours to look at yet.');
  }

  const key = input.variant === 'thumb' ? thumbnailKey(photo.s3Key) : photo.s3Key;
  const url = await media.createDownloadUrl(key);
  return ok({ url });
}
