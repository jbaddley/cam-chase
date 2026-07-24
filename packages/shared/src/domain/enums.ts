/** Roles a person can hold within a single game. */
export const ROLES = ['host', 'captain', 'member', 'judge', 'spectator'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Game lifecycle states. The game is a server-authoritative state machine;
 * see docs/01-product-spec.md.
 */
export const GAME_STATES = [
  'draft',
  'lobby',
  'round1_active',
  'round1_return',
  'round2_active',
  'round2_return',
  'rating',
  'finals_voting',
  'results',
  'archived',
] as const;
export type GameState = (typeof GAME_STATES)[number];

/**
 * Round 2 photo-assignment strategies. round_robin/random ship in Phase 1;
 * relay (per-member participation) and decoy (bluffing) are added in Phase 4.
 */
export const GAME_TYPES = ['round_robin', 'random', 'relay', 'decoy'] as const;
export type GameType = (typeof GAME_TYPES)[number];

/** Monetization tiers. Only the host's tier gates advanced features. */
export const TIERS = ['free', 'game_pack', 'unlimited'] as const;
export type Tier = (typeof TIERS)[number];

/** Preset special-voting categories (docs/01-product-spec.md). */
export const PRESET_CATEGORIES = [
  'worst_attempt',
  'craziest_pose',
  'most_difficult_angle',
  'most_creative_clue',
  'best_photobomb',
] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

/** The two rating axes scored by voters for each chase. */
export const RATING_AXES = ['pose', 'angle'] as const;
export type RatingAxis = (typeof RATING_AXES)[number];

/** Reasons a photo can be penalized. */
export const FOUL_REASONS = ['missing_clue', 'missing_face'] as const;
export type FoulReason = (typeof FOUL_REASONS)[number];
