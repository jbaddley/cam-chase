import { z } from 'zod';
import { GAME_MODES, GAME_TYPES, PRESET_CATEGORIES, type GameMode, type Tier } from '../domain/enums.js';
import { FREE_DEFAULT_ROUNDS, TIER_LIMITS } from './tiers.js';

const roundMinutes = z.number().int().min(5).max(20);

export const SpecialCategoriesSchema = z.object({
  presets: z.array(z.enum(PRESET_CATEGORIES)).max(PRESET_CATEGORIES.length),
  /** User-created categories, saved to the host profile for reuse. */
  custom: z.array(z.string().min(1).max(40)).max(5),
});
export type SpecialCategories = z.infer<typeof SpecialCategoriesSchema>;

export const GameConfigSchema = z
  .object({
    /** Which game this is. Everything else is interpreted in its light. */
    mode: z.enum(GAME_MODES).default('photo_chase'),
    photosPerRound: z.number().int().min(5).max(20),
    round1Minutes: roundMinutes,
    round2Minutes: roundMinutes,
    maxTeams: z.number().int().min(2).max(6),
    gameType: z.enum(GAME_TYPES),
    /** Judge/spectator vote multiplier. */
    judgeWeight: z.number().int().min(1).max(5),
    specialCategories: SpecialCategoriesSchema,
    geofencing: z.boolean(),
    /**
     * Where teams check in at the end of each round. Optional: without it,
     * check-ins are accepted anywhere and only their timing counts.
     */
    returnSpot: z
      .object({ lat: z.number(), lng: z.number(), radiusM: z.number().positive().max(5000) })
      .optional(),
    aiJudging: z.boolean(),
  })
  .strict();
export type GameConfig = z.infer<typeof GameConfigSchema>;

/** A sensible paid-tier default a host can start from. */
export const DEFAULT_CONFIG: GameConfig = {
  mode: 'photo_chase',
  photosPerRound: 8,
  round1Minutes: 15,
  round2Minutes: 15,
  maxTeams: 4,
  gameType: 'round_robin',
  judgeWeight: 2,
  specialCategories: { presets: [], custom: [] },
  geofencing: false,
  aiJudging: false,
};

/** The exact config the free tier plays with. */
export const FREE_CONFIG: GameConfig = {
  mode: 'photo_chase',
  ...FREE_DEFAULT_ROUNDS,
  maxTeams: 2,
  gameType: 'round_robin',
  judgeWeight: 1,
  specialCategories: { presets: [], custom: [] },
  geofencing: false,
  aiJudging: false,
};

export interface ConfigValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a config against a host's tier. Returns structured errors rather
 * than throwing so callers (client and server) can surface them per-field.
 */
export function validateConfigForTier(
  config: GameConfig,
  tier: Tier,
  /** Modes earned outside the tier (referral unlocks); see billing/entitlements. */
  unlockedModes: readonly GameMode[] = [],
): ConfigValidation {
  const errors: string[] = [];
  const limits = TIER_LIMITS[tier];

  const mode = config.mode ?? 'photo_chase';
  if (!limits.allowedModes.includes(mode) && !unlockedModes.includes(mode)) {
    errors.push(`Tier "${tier}" does not include the "${mode}" mode.`);
  }
  if (config.maxTeams > limits.maxTeams) {
    errors.push(`Tier "${tier}" allows at most ${limits.maxTeams} teams.`);
  }
  if (!limits.allowedGameTypes.includes(config.gameType)) {
    errors.push(`Tier "${tier}" does not allow game type "${config.gameType}".`);
  }
  if (config.judgeWeight > limits.maxJudgeWeight) {
    errors.push(`Tier "${tier}" caps judge weight at ${limits.maxJudgeWeight}x.`);
  }
  const usesSpecial =
    config.specialCategories.presets.length > 0 || config.specialCategories.custom.length > 0;
  if (usesSpecial && !limits.allowSpecialCategories) {
    errors.push(`Tier "${tier}" does not support special voting categories.`);
  }
  if (config.geofencing && !limits.allowGeofencing) {
    errors.push(`Tier "${tier}" does not support geofencing.`);
  }
  if (config.aiJudging && !limits.allowAiJudging) {
    errors.push(`Tier "${tier}" does not support AI judging.`);
  }
  if (!limits.configurableRounds) {
    const { photosPerRound, round1Minutes, round2Minutes } = FREE_DEFAULT_ROUNDS;
    if (
      config.photosPerRound !== photosPerRound ||
      config.round1Minutes !== round1Minutes ||
      config.round2Minutes !== round2Minutes
    ) {
      errors.push(`Tier "${tier}" uses fixed round settings and cannot customize them.`);
    }
  }

  return { ok: errors.length === 0, errors };
}
