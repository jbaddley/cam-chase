import { client } from './api.js';
import type { ProfileView } from '@photochase/client';

/**
 * The signed-in player's profile, held in memory for the session.
 *
 * Identity moved off the per-game "your name" field and onto the login (docs
 * plan: Identity). The display name lives here so the join flow can read it
 * without asking again — one person is one person across every game they play.
 *
 * A module-level cache like {@link session}, not React state: it is read from
 * screens that never render the profile itself (the join flow), and threading it
 * through every one of them would be the per-game field's spread problem again.
 */
let current: ProfileView | null = null;

/** Fetch the profile from the server into the cache. Null means none yet. */
export async function loadProfile(): Promise<ProfileView | null> {
  current = await client.getProfile();
  return current;
}

/** The cached profile, or null before {@link loadProfile} resolves. */
export function currentProfile(): ProfileView | null {
  return current;
}

/** Update the cache after a save, so the app need not refetch. */
export function setCurrentProfile(profile: ProfileView): void {
  current = profile;
}

/** Forget the cached profile (sign-out, or a test resetting state). */
export function clearProfile(): void {
  current = null;
}
