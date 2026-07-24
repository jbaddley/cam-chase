import { describe, expect, it } from 'vitest';
import {
  aiPointsFor,
  runBudgetedJudging,
  StubJudge,
  type JudgePair,
} from './judge.js';

function pairs(n: number): JudgePair[] {
  return Array.from({ length: n }, (_, i) => ({
    assignmentId: `a${i}`,
    originalRef: `orig-${i}`,
    chaseRef: `chase-${i}`,
  }));
}

describe('StubJudge', () => {
  it('is deterministic and in range', async () => {
    const judge = new StubJudge();
    const a = await judge.judge({ assignmentId: 'x', originalRef: 'o', chaseRef: 'c' });
    const b = await judge.judge({ assignmentId: 'x', originalRef: 'o', chaseRef: 'c' });
    expect(a).toEqual(b);
    expect(a.poseScore).toBeGreaterThanOrEqual(0);
    expect(a.poseScore).toBeLessThanOrEqual(10);
  });
});

describe('runBudgetedJudging', () => {
  it('judges all pairs when within budget', async () => {
    const result = await runBudgetedJudging(new StubJudge(), pairs(5), { budgetCents: 30, costPerJudgementCents: 1 });
    expect(result.judgedCount).toBe(5);
    expect(result.skippedCount).toBe(0);
    expect(result.degraded).toBe(false);
    expect(result.spentCents).toBe(5);
  });

  it('stops at the budget cap and degrades to human-only for the rest', async () => {
    const result = await runBudgetedJudging(new StubJudge(), pairs(40), { budgetCents: 30, costPerJudgementCents: 1 });
    expect(result.judgedCount).toBe(30);
    expect(result.skippedCount).toBe(10);
    expect(result.degraded).toBe(true);
    expect(result.spentCents).toBe(30);
  });

  it('judges nothing when the kill switch is on', async () => {
    const result = await runBudgetedJudging(new StubJudge(), pairs(5), { killSwitch: true });
    expect(result.killed).toBe(true);
    expect(result.judgedCount).toBe(0);
    expect(result.spentCents).toBe(0);
  });

  it('respects the default AI cap when no budget is given', async () => {
    // Default cap is 30 cents at 1 cent/pair → at most 30 judged.
    const result = await runBudgetedJudging(new StubJudge(), pairs(100));
    expect(result.judgedCount).toBe(30);
    expect(result.degraded).toBe(true);
  });
});

describe('aiPointsFor', () => {
  it('sums pose + angle + half the location match', () => {
    expect(aiPointsFor({ poseScore: 8, angleScore: 6, locationMatch: 10, clueVisible: true, confidence: 0.9 })).toBe(19);
  });
});
