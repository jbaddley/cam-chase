import { z } from 'zod';
import type { Result } from './handlers.js';
import type { ProfileRepository, UserProfile } from './profile-repo.js';

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const err = (error: string): Result<never> => ({ ok: false, error });

/** A profile field: trimmed, present, and short enough to lay out. */
const NAME = z.string().trim().min(1).max(40);

const ProfileInput = z.object({
  firstName: NAME,
  lastName: NAME,
  displayName: NAME,
});

/**
 * The caller's own profile, or null when they have not completed one yet — the
 * app shows the "complete your profile" form on null. `userId` comes from the
 * verified token, never the body, so a caller can only ever read their own.
 */
export async function getMyProfile(
  repo: ProfileRepository,
  userId: string,
): Promise<Result<UserProfile | null>> {
  if (!userId) return err('Not signed in.');
  return ok(await repo.get(userId));
}

/**
 * Create or replace the caller's profile. A full replace rather than a patch:
 * the edit screen already holds the whole profile, and one shape is simpler than
 * a merge. `userId` is the token's, so this can only ever write the caller's own
 * — the body carries names, never an identity.
 */
export async function saveMyProfile(
  repo: ProfileRepository,
  userId: string,
  raw: unknown,
): Promise<Result<UserProfile>> {
  if (!userId) return err('Not signed in.');
  const parsed = ProfileInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const profile: UserProfile = { userId, ...parsed.data };
  await repo.save(profile);
  return ok(profile);
}
