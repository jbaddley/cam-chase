import type { TeamScore } from '../domain/types.js';

/**
 * AI game recap (docs/04 paid features). A provider-agnostic, deterministic
 * commentary generator. The stub below needs no network; a real LLM generator
 * can implement the same RecapGenerator seam later.
 */

export interface RecapInput {
  /** Final scoreboard, best-first. */
  scoreboard: TeamScore[];
  /** teamId → display name. */
  teamNames: Record<string, string>;
  bestMatchTeamId?: string;
}

const NARROW_MARGIN = 20;

/** Deterministic sports-commentary-style recap of a finished game. */
export function generateRecap(input: RecapInput): string {
  const board = input.scoreboard;
  if (board.length === 0) return 'No teams played — no recap available.';
  const name = (teamId: string) => input.teamNames[teamId] ?? teamId;

  const winner = board[0]!;
  const lines: string[] = [`🏆 ${name(winner.teamId)} take the crown with ${winner.total} points!`];

  const runnerUp = board[1];
  if (runnerUp) {
    const margin = winner.total - runnerUp.total;
    lines.push(
      margin <= NARROW_MARGIN
        ? `A nail-biter — just ${margin} ahead of ${name(runnerUp.teamId)}.`
        : `A commanding ${margin}-point lead over ${name(runnerUp.teamId)}.`,
    );
  }

  if (input.bestMatchTeamId) {
    lines.push(`Best overall match went to ${name(input.bestMatchTeamId)}.`);
  }

  // Highlight the sharpest navigator by location points.
  const topLocation = [...board].sort((a, b) => b.location - a.location || a.teamId.localeCompare(b.teamId))[0]!;
  if (topLocation.location > 0) {
    lines.push(`${name(topLocation.teamId)} nailed the locations with ${topLocation.location} location points.`);
  }

  return lines.join(' ');
}

/** Seam for swapping in a real LLM recap generator later. */
export interface RecapGenerator {
  generate(input: RecapInput): Promise<string>;
}

export class StubRecapGenerator implements RecapGenerator {
  async generate(input: RecapInput): Promise<string> {
    return generateRecap(input);
  }
}
