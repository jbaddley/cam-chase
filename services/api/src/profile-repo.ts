/**
 * A player's identity, captured once at first sign-in and editable afterwards.
 *
 * It lives here rather than on the game because a person is one person across
 * every game they play — the per-game "your name" field it replaces made a new
 * identity each time. The display name is what other players see; first and last
 * are for the account, not the scoreboard.
 */
import type { DistanceUnits } from '@photochase/shared';

export interface UserProfile {
  userId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  /** Distance units the player reads. Defaults to metric when unset (old profiles). */
  units: DistanceUnits;
}

/**
 * Persistence port for user profiles, stored on the same `USER#` partition as
 * entitlements (docs/02, one item per aggregate).
 */
export interface ProfileRepository {
  get(userId: string): Promise<UserProfile | null>;
  save(profile: UserProfile): Promise<void>;
}

export class InMemoryProfileRepository implements ProfileRepository {
  private readonly byUser = new Map<string, UserProfile>();

  async get(userId: string): Promise<UserProfile | null> {
    return this.byUser.get(userId) ?? null;
  }

  async save(profile: UserProfile): Promise<void> {
    this.byUser.set(profile.userId, profile);
  }
}
