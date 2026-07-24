import { describe, expect, it } from 'vitest';
import { planAssignments, type TeamPhotos } from './assignment.js';
import {
  DECOY_CORRECT_BONUS,
  DECOY_FALSE_FLAG_PENALTY,
  DECOY_FOOLED_BONUS,
  resolveDecoyBonuses,
} from './decoy.js';

describe('decoy assignment', () => {
  it('distributes like random (no team gets its own photo)', () => {
    const teams: TeamPhotos[] = [
      { teamId: 'A', photoIds: ['A0', 'A1', 'A2'] },
      { teamId: 'B', photoIds: ['B0', 'B1', 'B2'] },
      { teamId: 'C', photoIds: ['C0', 'C1', 'C2'] },
    ];
    const plans = planAssignments(teams, 'decoy', 7);
    expect(plans).toHaveLength(9);
    expect(plans.every((p) => p.chaserTeamId !== p.ownerTeamId)).toBe(true);
  });
});

describe('resolveDecoyBonuses', () => {
  it('rewards a correct decoy flag', () => {
    const bonuses = resolveDecoyBonuses({
      decoyPhotoIds: ['B1'],
      guesses: [{ chaserTeamId: 'A', ownerTeamId: 'B', originalPhotoId: 'B1', flaggedAsDecoy: true }],
    });
    expect(bonuses).toEqual({ A: DECOY_CORRECT_BONUS });
  });

  it('rewards the setter when the chaser is fooled', () => {
    const bonuses = resolveDecoyBonuses({
      decoyPhotoIds: ['B1'],
      guesses: [{ chaserTeamId: 'A', ownerTeamId: 'B', originalPhotoId: 'B1', flaggedAsDecoy: false }],
    });
    expect(bonuses).toEqual({ B: DECOY_FOOLED_BONUS });
  });

  it('penalizes a false flag on a genuine photo', () => {
    const bonuses = resolveDecoyBonuses({
      decoyPhotoIds: ['B1'],
      guesses: [{ chaserTeamId: 'A', ownerTeamId: 'B', originalPhotoId: 'B0', flaggedAsDecoy: true }],
    });
    expect(bonuses).toEqual({ A: -DECOY_FALSE_FLAG_PENALTY });
  });

  it('scores nothing for correctly leaving a genuine photo unflagged', () => {
    const bonuses = resolveDecoyBonuses({
      decoyPhotoIds: ['B1'],
      guesses: [{ chaserTeamId: 'A', ownerTeamId: 'B', originalPhotoId: 'B0', flaggedAsDecoy: false }],
    });
    expect(bonuses).toEqual({});
  });

  it('accumulates across multiple guesses', () => {
    const bonuses = resolveDecoyBonuses({
      decoyPhotoIds: ['A1', 'B1'],
      guesses: [
        { chaserTeamId: 'C', ownerTeamId: 'A', originalPhotoId: 'A1', flaggedAsDecoy: true }, // +30 C
        { chaserTeamId: 'A', ownerTeamId: 'B', originalPhotoId: 'B1', flaggedAsDecoy: false }, // +20 B
        { chaserTeamId: 'C', ownerTeamId: 'A', originalPhotoId: 'A0', flaggedAsDecoy: true }, // -10 C
      ],
    });
    expect(bonuses).toEqual({ C: DECOY_CORRECT_BONUS - DECOY_FALSE_FLAG_PENALTY, B: DECOY_FOOLED_BONUS });
  });
});
