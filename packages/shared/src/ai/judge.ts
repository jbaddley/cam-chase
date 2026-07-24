import { AI_CAP_CENTS } from '../billing/pricing.js';

/**
 * Provider-agnostic AI judging (docs/04-ai-strategy.md). A Judge scores a
 * downscaled original/chase pair; the concrete provider (Claude vision, etc.)
 * lives behind this port. Runs are budget-capped and kill-switchable.
 */

/** References are downscaled (≤1024px) image handles — never full-res. */
export interface JudgePair {
  assignmentId: string;
  originalRef: string;
  chaseRef: string;
}

/** Structured scores on a 0–10 scale plus booleans and a confidence. */
export interface JudgeScore {
  poseScore: number;
  angleScore: number;
  locationMatch: number;
  clueVisible: boolean;
  confidence: number;
}

export interface AiJudgement extends JudgeScore {
  assignmentId: string;
}

export interface Judge {
  judge(pair: JudgePair): Promise<JudgeScore>;
}

/** Default per-pair cost estimate in US cents (see docs/04 cost controls). */
export const COST_PER_JUDGEMENT_CENTS = 1;

/** A deterministic judge for tests and offline simulation (no network). */
export class StubJudge implements Judge {
  async judge(pair: JudgePair): Promise<JudgeScore> {
    const h = hash(`${pair.originalRef}|${pair.chaseRef}`);
    return {
      poseScore: h % 11,
      angleScore: (h >> 4) % 11,
      locationMatch: (h >> 8) % 11,
      clueVisible: (h & 1) === 0,
      confidence: ((h >> 12) % 100) / 100,
    };
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface BudgetedJudgingOptions {
  /** Global kill switch: when true, no judging runs at all. */
  killSwitch?: boolean;
  /** Hard per-game budget in cents (defaults to the AI cap). */
  budgetCents?: number;
  costPerJudgementCents?: number;
}

export interface JudgingResult {
  judgements: AiJudgement[];
  judgedCount: number;
  skippedCount: number;
  spentCents: number;
  /** True if the budget cap stopped judging before all pairs were scored. */
  degraded: boolean;
  /** True if the kill switch prevented all judging. */
  killed: boolean;
}

/**
 * Judge as many pairs as the per-game budget allows, in order. When the cap is
 * reached the remainder is skipped (the game degrades to human-only scoring for
 * those pairs). Honors a global kill switch.
 */
export async function runBudgetedJudging(
  judge: Judge,
  pairs: JudgePair[],
  options: BudgetedJudgingOptions = {},
): Promise<JudgingResult> {
  const budgetCents = options.budgetCents ?? AI_CAP_CENTS;
  const costPer = options.costPerJudgementCents ?? COST_PER_JUDGEMENT_CENTS;

  if (options.killSwitch) {
    return { judgements: [], judgedCount: 0, skippedCount: pairs.length, spentCents: 0, degraded: pairs.length > 0, killed: true };
  }

  const judgements: AiJudgement[] = [];
  let spentCents = 0;
  for (const pair of pairs) {
    if (spentCents + costPer > budgetCents) break;
    const score = await judge.judge(pair);
    judgements.push({ assignmentId: pair.assignmentId, ...score });
    spentCents += costPer;
  }

  return {
    judgements,
    judgedCount: judgements.length,
    skippedCount: pairs.length - judgements.length,
    spentCents,
    degraded: judgements.length < pairs.length,
    killed: false,
  };
}

/** Convert a judgement into bonus points shown alongside human votes. */
export function aiPointsFor(judgement: JudgeScore): number {
  // Pose + angle on a 0–10 scale; location adds up to half its weight.
  return judgement.poseScore + judgement.angleScore + Math.round(judgement.locationMatch / 2);
}
