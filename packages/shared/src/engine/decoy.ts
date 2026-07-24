/**
 * Decoy game type scoring (docs/01 game-type ideas). Each team plants one
 * intentionally misleading photo. A chasing team can flag a received original as
 * a decoy: a correct flag earns the chaser a bonus, and a decoy that fools its
 * chaser earns the setting team a bonus. A wrong flag costs a small penalty.
 */

export const DECOY_CORRECT_BONUS = 30;
export const DECOY_FOOLED_BONUS = 20;
export const DECOY_FALSE_FLAG_PENALTY = 10;

export interface DecoyGuess {
  chaserTeamId: string;
  originalPhotoId: string;
  ownerTeamId: string;
  flaggedAsDecoy: boolean;
}

export interface DecoyResolutionInput {
  /** Photo ids that were declared decoys by their owners. */
  decoyPhotoIds: string[];
  guesses: DecoyGuess[];
}

/**
 * Resolve decoy bonuses into a per-team points map (values may be negative for
 * false flags). Deterministic and pure.
 */
export function resolveDecoyBonuses(input: DecoyResolutionInput): Record<string, number> {
  const decoys = new Set(input.decoyPhotoIds);
  const bonuses: Record<string, number> = {};
  const add = (teamId: string, points: number) => {
    bonuses[teamId] = (bonuses[teamId] ?? 0) + points;
  };

  for (const guess of input.guesses) {
    const isDecoy = decoys.has(guess.originalPhotoId);
    if (guess.flaggedAsDecoy && isDecoy) {
      add(guess.chaserTeamId, DECOY_CORRECT_BONUS);
    } else if (!guess.flaggedAsDecoy && isDecoy) {
      add(guess.ownerTeamId, DECOY_FOOLED_BONUS); // setter fooled the chaser
    } else if (guess.flaggedAsDecoy && !isDecoy) {
      add(guess.chaserTeamId, -DECOY_FALSE_FLAG_PENALTY);
    }
  }
  return bonuses;
}
