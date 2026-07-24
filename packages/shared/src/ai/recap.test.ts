import { describe, expect, it } from 'vitest';
import type { TeamScore } from '../domain/types.js';
import { generateRecap, StubRecapGenerator } from './recap.js';

function score(teamId: string, total: number, location = 0): TeamScore {
  return {
    teamId,
    location,
    pose: 0,
    angle: 0,
    timeBonus: 0,
    bestMatchBonus: 0,
    specialBonus: 0,
    foulPenalty: 0,
    total,
  };
}

const teamNames = { A: 'Red Foxes', B: 'Blue Jays' };

describe('generateRecap', () => {
  it('names the winner and is deterministic', () => {
    const input = { scoreboard: [score('A', 200, 300), score('B', 120)], teamNames, bestMatchTeamId: 'A' };
    const recap = generateRecap(input);
    expect(recap).toBe(generateRecap(input));
    expect(recap).toContain('Red Foxes take the crown with 200 points');
    expect(recap).toContain('Best overall match went to Red Foxes');
    expect(recap).toContain('300 location points');
  });

  it('describes a commanding lead vs a nail-biter', () => {
    expect(generateRecap({ scoreboard: [score('A', 200), score('B', 120)], teamNames })).toContain('commanding');
    expect(generateRecap({ scoreboard: [score('A', 200), score('B', 190)], teamNames })).toContain('nail-biter');
  });

  it('handles an empty board', () => {
    expect(generateRecap({ scoreboard: [], teamNames: {} })).toMatch(/No teams played/);
  });
});

describe('StubRecapGenerator', () => {
  it('implements the generator seam', async () => {
    const recap = await new StubRecapGenerator().generate({ scoreboard: [score('A', 100)], teamNames });
    expect(recap).toContain('Red Foxes');
  });
});
