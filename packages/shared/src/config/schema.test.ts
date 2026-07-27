import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  FREE_CONFIG,
  GameConfigSchema,
  validateConfigForTier,
  type GameConfig,
} from './schema.js';

describe('GameConfigSchema', () => {
  it('accepts a valid paid-tier default', () => {
    expect(GameConfigSchema.safeParse(DEFAULT_CONFIG).success).toBe(true);
  });

  it.each([
    ['photosPerRound below range', { photosPerRound: 4 }],
    ['photosPerRound above range', { photosPerRound: 21 }],
    ['round1Minutes below range', { round1Minutes: 4 }],
    ['round2Minutes above range', { round2Minutes: 21 }],
    ['maxTeams below range', { maxTeams: 1 }],
    ['maxTeams above range', { maxTeams: 7 }],
    ['judgeWeight below range', { judgeWeight: 0 }],
    ['judgeWeight above range', { judgeWeight: 6 }],
  ])('rejects %s', (_label, patch) => {
    const result = GameConfigSchema.safeParse({ ...DEFAULT_CONFIG, ...patch });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = GameConfigSchema.safeParse({ ...DEFAULT_CONFIG, sneaky: true });
    expect(result.success).toBe(false);
  });

  it('caps custom categories at 5', () => {
    const custom = ['a', 'b', 'c', 'd', 'e', 'f'];
    const config = { ...DEFAULT_CONFIG, specialCategories: { presets: [], custom } };
    expect(GameConfigSchema.safeParse(config).success).toBe(false);
  });
});

describe('validateConfigForTier', () => {
  it('accepts the free default on the free tier', () => {
    expect(validateConfigForTier(FREE_CONFIG, 'free')).toEqual({ ok: true, errors: [] });
  });

  it('rejects >2 teams on the free tier', () => {
    const config: GameConfig = { ...FREE_CONFIG, maxTeams: 4 };
    const result = validateConfigForTier(config, 'free');
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/at most 2 teams/);
  });

  it('rejects random game type on the free tier', () => {
    const config: GameConfig = { ...FREE_CONFIG, gameType: 'random' };
    expect(validateConfigForTier(config, 'free').ok).toBe(false);
  });

  it('rejects AI judging, geofencing, and special categories on the free tier', () => {
    expect(validateConfigForTier({ ...FREE_CONFIG, aiJudging: true }, 'free').ok).toBe(false);
    expect(validateConfigForTier({ ...FREE_CONFIG, geofencing: true }, 'free').ok).toBe(false);
    expect(
      validateConfigForTier(
        { ...FREE_CONFIG, specialCategories: { presets: ['craziest_pose'], custom: [] } },
        'free',
      ).ok,
    ).toBe(false);
  });

  it('rejects customized rounds on the free tier', () => {
    const config: GameConfig = { ...FREE_CONFIG, photosPerRound: 12 };
    expect(validateConfigForTier(config, 'free').ok).toBe(false);
  });

  it('accepts a fully configured game on paid tiers', () => {
    const config: GameConfig = {
      mode: 'photo_chase',
      photosPerRound: 20,
      round1Minutes: 20,
      round2Minutes: 20,
      maxTeams: 6,
      gameType: 'random',
      judgeWeight: 5,
      specialCategories: { presets: ['worst_attempt', 'craziest_pose'], custom: ['Best Hat'] },
      geofencing: true,
      aiJudging: true,
    };
    expect(validateConfigForTier(config, 'game_pack')).toEqual({ ok: true, errors: [] });
    expect(validateConfigForTier(config, 'unlimited')).toEqual({ ok: true, errors: [] });
  });
});
