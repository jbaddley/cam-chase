import type { GameType, Tier } from '../domain/enums.js';

export interface TierLimits {
  /** Maximum teams allowed in a game hosted on this tier. */
  maxTeams: number;
  /** Game types the host may choose. */
  allowedGameTypes: readonly GameType[];
  /** Highest judge/spectator vote multiplier selectable. */
  maxJudgeWeight: number;
  allowSpecialCategories: boolean;
  allowGeofencing: boolean;
  allowAiJudging: boolean;
  /** Free tier locks photo/minute counts to the defaults below. */
  configurableRounds: boolean;
  /** Games the tier grants; 'unlimited' for subscriptions. */
  gamesGranted: number | 'unlimited';
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    maxTeams: 2,
    allowedGameTypes: ['round_robin'],
    maxJudgeWeight: 1,
    allowSpecialCategories: false,
    allowGeofencing: false,
    allowAiJudging: false,
    configurableRounds: false,
    gamesGranted: 'unlimited',
  },
  game_pack: {
    maxTeams: 6,
    allowedGameTypes: ['round_robin', 'random'],
    maxJudgeWeight: 5,
    allowSpecialCategories: true,
    allowGeofencing: true,
    allowAiJudging: true,
    configurableRounds: true,
    gamesGranted: 2,
  },
  unlimited: {
    maxTeams: 6,
    allowedGameTypes: ['round_robin', 'random'],
    maxJudgeWeight: 5,
    allowSpecialCategories: true,
    allowGeofencing: true,
    allowAiJudging: true,
    configurableRounds: true,
    gamesGranted: 'unlimited',
  },
};

/** Fixed configuration the free tier always plays with. */
export const FREE_DEFAULT_ROUNDS = {
  photosPerRound: 5,
  round1Minutes: 10,
  round2Minutes: 10,
} as const;
