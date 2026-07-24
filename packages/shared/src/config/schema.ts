import { z } from 'zod';
import { GAME_TYPES, PRESET_CATEGORIES, type Tier } from '../domain/enums.js';
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
    photosPerRound: z.number().int().min(5).max(20),
    round1Minutes: roundMinutes,
    round2Minutes: roundMinutes,
    maxTeams: z.number().int().min(2).max(6),
    gameType: z.enum(GAME_TYPES),
    /** Judge/spectator vote multiplier. */
    judgeWeight: z.number().int().min(1).max(5),
    specialCategories: SpecialCategoriesSchema,
    geofencing: z.boolean(),
    aiJudging: z.boolean(),
  })
  .strict();
export type GameConfig = z.infer<typeof GameConfigSchema>;

/** A sensible paid-tier default a host can start from. */
export const DEFAULT_CONFIG: GameConfig = {
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
export function validateConfigForTier(config: GameConfig, tier: Tier): ConfigValidation {
  const errors: string[] = [];
  const limits = TIER_LIMITS[tier];

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
