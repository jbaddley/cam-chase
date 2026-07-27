/**
 * Colour Hunt scoring.
 *
 * Two ways to score, deliberately opposed:
 *
 * - **Reading**: every element of another team's secret you guess right.
 * - **Bluffing**: every element another team got *wrong* about yours.
 *
 * The bluff bonus is what makes hiding an active, scored skill rather than a
 * passive hope — the same philosophy as the chase's `decoy` game type. It only
 * works if the validity check has teeth: a team that simply left the attribute
 * out of its photos would otherwise be unguessable and win by cheating. So
 * judges confirm the attribute really was there, and an unconfirmed team keeps
 * nothing it bluffed.
 *
 * Emits the same `TeamScore` shape as every other mode, so results, spectator
 * view and league standings work without knowing the mode.
 */

import type { TeamScore } from '../../domain/types.js';
import { applyFinalsBonuses, applyFouls, emptyScores, totalise } from '../../engine/scoring.js';
import { correctElements, elementCount, type AttributeGuess, type AttributeSet } from './attributes.js';

/** Points for each element of a secret read correctly. */
export const ELEMENT_POINTS = 20;

/** Points a shooting team earns for each element a guesser got wrong. */
export const BLUFF_POINTS = 10;

/** One team's committed guess about another's secret. */
export interface ColorGuessRecord {
  guesserTeamId: string;
  subjectTeamId: string;
  guess: AttributeGuess;
}

export interface ColorScoringInput {
  teamIds: string[];
  /** Each team's secret attribute set. */
  secrets: Readonly<Record<string, AttributeSet>>;
  guesses: readonly ColorGuessRecord[];
  /**
   * teamId → whether judges confirmed the attribute really appeared in that
   * team's photos. A team absent from this map counts as confirmed: most games
   * have nobody moderating, and voiding every bluff by default would gut the
   * mode rather than police it.
   */
  confirmed?: Readonly<Record<string, boolean>>;
  fouls?: Record<string, number>;
  specialWinners?: string[];
  bestMatchTeamId?: string;
}

/**
 * Score a finished colour hunt. A guesser scores each subject at most once, so
 * resubmitting a guess cannot farm points.
 */
export function scoreColorHunt(input: ColorScoringInput): TeamScore[] {
  const scores = emptyScores(input.teamIds);
  const counted = new Set<string>();

  for (const record of input.guesses) {
    if (record.guesserTeamId === record.subjectTeamId) continue; // never guess yourself
    const key = `${record.guesserTeamId}::${record.subjectTeamId}`;
    if (counted.has(key)) continue;
    counted.add(key);

    const secret = input.secrets[record.subjectTeamId];
    if (!secret) continue;

    const hits = correctElements(secret, record.guess);
    const misses = elementCount(secret) - hits;

    // Reading lands in `location` — the mode's main scoring column, matching
    // how the scavenger scorer uses it, so the results breakdown stays aligned.
    const guesser = scores.get(record.guesserTeamId);
    if (guesser) guesser.location += hits * ELEMENT_POINTS;

    // A team that never really showed its attribute has nothing to be proud of
    // having hidden, so its bluff pays nothing.
    if (input.confirmed?.[record.subjectTeamId] === false) continue;
    const subject = scores.get(record.subjectTeamId);
    if (subject) subject.pose += misses * BLUFF_POINTS;
  }

  applyFouls(scores, input.fouls);
  applyFinalsBonuses(scores, input.bestMatchTeamId, input.specialWinners);
  return totalise(scores);
}
