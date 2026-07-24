import { DEFAULT_CONFIG, type Game, type Photo } from '@photochase/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEntitlementRepository } from './entitlements-repo.js';
import {
  attributeReferral,
  createShareCard,
  creditReferralOnGameFinished,
  issueReferralCode,
  runGameJudging,
} from './growth-handlers.js';
import { InMemoryAiJudgingRepository, InMemoryReferralRepository } from './growth-repo.js';
import { InMemoryGameRepository } from './repository.js';

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

function photo(id: string, teamId: string): Photo {
  return {
    id,
    gameId: 'g1',
    teamId,
    shooterUserId: 'u',
    order: 0,
    location: { lat: 0, lng: 0 },
    capturedAt: 0,
    s3Key: `photos/${id}.jpg`,
    fouls: [],
  };
}

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    hostUserId: 'host',
    code: 'ABC123',
    tier: 'game_pack',
    config: { ...DEFAULT_CONFIG, aiJudging: true },
    state: 'rating',
    teams: [
      { id: 'A', gameId: 'g1', name: 'Reds', createdAt: 0 },
      { id: 'B', gameId: 'g1', name: 'Blues', createdAt: 0 },
    ],
    memberships: [],
    photos: [],
    assignments: [],
    votes: [],
    createdAt: 0,
    ...overrides,
  };
}

describe('referral crediting', () => {
  let refRepo: InMemoryReferralRepository;
  let entRepo: InMemoryEntitlementRepository;
  beforeEach(() => {
    refRepo = new InMemoryReferralRepository();
    entRepo = new InMemoryEntitlementRepository();
  });

  it('issues a deterministic code', () => {
    expect(issueReferralCode('r').code).toBe(issueReferralCode('r').code);
  });

  it('grants the referrer a game credit on the invitee first finish', async () => {
    await unwrap(attributeReferral(refRepo, { referrerUserId: 'r', inviteeUserId: 'i', at: 1000 }));
    const result = await unwrap(creditReferralOnGameFinished(refRepo, entRepo, { inviteeUserId: 'i', finishedAt: 2000 }));
    expect(result.credited).toBe(true);
    const ent = await entRepo.getOrCreate('r');
    expect(ent.gameCredits).toBe(1);
    expect(ent.tier).toBe('game_pack');
  });

  it('does not double-credit on a second finish', async () => {
    await unwrap(attributeReferral(refRepo, { referrerUserId: 'r', inviteeUserId: 'i', at: 1000 }));
    await unwrap(creditReferralOnGameFinished(refRepo, entRepo, { inviteeUserId: 'i', finishedAt: 2000 }));
    const second = await unwrap(creditReferralOnGameFinished(refRepo, entRepo, { inviteeUserId: 'i', finishedAt: 3000 }));
    expect(second.credited).toBe(false);
    expect((await entRepo.getOrCreate('r')).gameCredits).toBe(1);
  });

  it('rejects self-referral at attribution', async () => {
    const result = await attributeReferral(refRepo, { referrerUserId: 'x', inviteeUserId: 'x', at: 1 });
    expect(result.ok).toBe(false);
  });
});

describe('runGameJudging', () => {
  let games: InMemoryGameRepository;
  let ai: InMemoryAiJudgingRepository;
  beforeEach(() => {
    games = new InMemoryGameRepository();
    ai = new InMemoryAiJudgingRepository();
  });

  async function seedJudgeableGame(n: number) {
    const photos: Photo[] = [];
    const assignments = [];
    for (let i = 0; i < n; i++) {
      const orig = photo(`o${i}`, 'A');
      const chase = photo(`c${i}`, 'B');
      photos.push(orig, chase);
      assignments.push({ id: `a${i}`, gameId: 'g1', chaserTeamId: 'B', originalPhotoId: orig.id, order: i, chasePhotoId: chase.id });
    }
    await games.save(makeGame({ photos, assignments }));
  }

  it('judges all completed chases within budget and stores them', async () => {
    await seedJudgeableGame(3);
    const result = await unwrap(runGameJudging(games, ai, { gameId: 'g1' }));
    expect(result.judgedCount).toBe(3);
    expect((await ai.get('g1'))!).toHaveLength(3);
  });

  it('degrades when the budget cap is exceeded', async () => {
    await seedJudgeableGame(5);
    const result = await unwrap(runGameJudging(games, ai, { gameId: 'g1', budgetCents: 2 }));
    expect(result.judgedCount).toBe(2);
    expect(result.degraded).toBe(true);
  });

  it('judges nothing when the kill switch is on', async () => {
    await seedJudgeableGame(3);
    const result = await unwrap(runGameJudging(games, ai, { gameId: 'g1', killSwitch: true }));
    expect(result.killed).toBe(true);
    expect(result.judgedCount).toBe(0);
  });

  it('refuses when AI judging is disabled for the game', async () => {
    await games.save(makeGame({ config: { ...DEFAULT_CONFIG, aiJudging: false } }));
    expect((await runGameJudging(games, ai, { gameId: 'g1' })).ok).toBe(false);
  });
});

describe('createShareCard consent gate', () => {
  let games: InMemoryGameRepository;
  beforeEach(async () => {
    games = new InMemoryGameRepository();
    await games.save(makeGame({ photos: [photo('o0', 'A'), photo('c0', 'B')] }));
  });

  it('builds a card when everyone depicted consented', async () => {
    const card = await unwrap(
      createShareCard(games, {
        gameId: 'g1',
        originalPhotoId: 'o0',
        chasePhotoId: 'c0',
        scoreStamp: 'Best match!',
        referralCode: 'REF123',
        depictedUserIds: ['u1', 'u2'],
        consentedUserIds: ['u1', 'u2'],
      }),
    );
    expect(card.status).toBe('active');
    expect(card.shareUrl).toContain('REF123');
  });

  it('refuses without full consent', async () => {
    const result = await createShareCard(games, {
      gameId: 'g1',
      originalPhotoId: 'o0',
      chasePhotoId: 'c0',
      scoreStamp: 'Best match!',
      referralCode: 'REF123',
      depictedUserIds: ['u1', 'u2'],
      consentedUserIds: ['u1'],
    });
    expect(result.ok).toBe(false);
  });
});
