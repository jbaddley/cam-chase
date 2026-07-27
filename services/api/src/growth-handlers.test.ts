import { availableModes, DEFAULT_CONFIG, type Game, type Photo } from '@photochase/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEntitlementRepository } from './entitlements-repo.js';
import {
  advanceGameWithRewards,
  attributeReferral,
  createShareCard,
  creditReferralOnGameFinished,
  creditReferralsForFinishedGame,
  getMyReferral,
  issueReferralCode,
  redeemReferralCode,
  runGameJudging,
  setSharingConsent,
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

  /** Credit `n` distinct invitees to referrer `r`. */
  async function creditInvitees(n: number) {
    for (let i = 0; i < n; i++) {
      await unwrap(attributeReferral(refRepo, { referrerUserId: 'r', inviteeUserId: `i${i}`, at: 1000 }));
      await unwrap(creditReferralOnGameFinished(refRepo, entRepo, { inviteeUserId: `i${i}`, finishedAt: 2000 }));
    }
  }

  it('unlocks the first mode on the first credited referral', async () => {
    await creditInvitees(1);
    expect((await entRepo.getOrCreate('r')).unlockedModes).toEqual(['scavenger_hunt']);
  });

  it('climbs the ladder as more invitees finish games', async () => {
    await creditInvitees(3);
    expect((await entRepo.getOrCreate('r')).unlockedModes).toEqual(['scavenger_hunt', 'color_hunt']);
  });

  it('unlocks nothing when nobody has finished a game yet', async () => {
    // Attribution alone must buy nothing, or install-farming would work.
    await unwrap(attributeReferral(refRepo, { referrerUserId: 'r', inviteeUserId: 'i', at: 1000 }));
    expect((await entRepo.getOrCreate('r')).unlockedModes).toBeUndefined();
  });

  it('lets an earned mode be hosted on the free tier', async () => {
    await creditInvitees(1);
    const ent = await entRepo.getOrCreate('r');
    expect(availableModes({ ...ent, tier: 'free', gameCredits: 0 })).toContain('scavenger_hunt');
  });
});

describe('getMyReferral', () => {
  let refRepo: InMemoryReferralRepository;
  beforeEach(() => {
    refRepo = new InMemoryReferralRepository();
  });

  it('reports a standing start with the first rung as the target', async () => {
    const view = await unwrap(getMyReferral(refRepo, 'r'));
    expect(view.creditedReferrals).toBe(0);
    expect(view.modesEarned).toEqual([]);
    expect(view.nextUnlock).toEqual({ mode: 'scavenger_hunt', referralsAway: 1 });
    expect(view.flair).toBeNull();
  });

  it('registers the code so it can be redeemed', async () => {
    // The code is a one-way hash, so nothing else could resolve it back.
    const view = await unwrap(getMyReferral(refRepo, 'r'));
    expect(await refRepo.findUserByCode(view.code)).toBe('r');
  });

  it('carries the code into a shareable link', async () => {
    const view = await unwrap(getMyReferral(refRepo, 'r'));
    expect(view.inviteUrl).toContain(view.code);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await getMyReferral(refRepo, '')).ok).toBe(false);
  });
});

describe('redeemReferralCode', () => {
  let refRepo: InMemoryReferralRepository;
  beforeEach(() => {
    refRepo = new InMemoryReferralRepository();
  });

  async function codeFor(userId: string): Promise<string> {
    return (await unwrap(getMyReferral(refRepo, userId))).code;
  }

  it('attributes an invitee to the code’s owner', async () => {
    const code = await codeFor('r');
    const result = await unwrap(redeemReferralCode(refRepo, { code, inviteeUserId: 'i' }, () => 5000));
    expect(result.attributed).toBe(true);
    expect((await refRepo.findByInvitee('i'))!.referrerUserId).toBe('r');
  });

  it('accepts a code typed in lower case', async () => {
    const code = await codeFor('r');
    expect((await unwrap(redeemReferralCode(refRepo, { code: code.toLowerCase(), inviteeUserId: 'i' }))).attributed).toBe(true);
  });

  it('rejects a code nobody owns', async () => {
    expect((await redeemReferralCode(refRepo, { code: 'NOSUCH', inviteeUserId: 'i' })).ok).toBe(false);
  });

  it('rejects self-referral', async () => {
    const code = await codeFor('r');
    expect((await redeemReferralCode(refRepo, { code, inviteeUserId: 'r' })).ok).toBe(false);
  });

  it('keeps the first invite, so a later code cannot steal the credit', async () => {
    const first = await codeFor('r1');
    const second = await codeFor('r2');
    await unwrap(redeemReferralCode(refRepo, { code: first, inviteeUserId: 'i' }));

    const again = await unwrap(redeemReferralCode(refRepo, { code: second, inviteeUserId: 'i' }));
    expect(again.attributed).toBe(false);
    expect((await refRepo.findByInvitee('i'))!.referrerUserId).toBe('r1');
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

  /** Two teams of two, with each member's consent set as given. */
  async function seedWithConsent(consent: Record<string, boolean | undefined>) {
    games = new InMemoryGameRepository();
    const memberships = Object.entries(consent).map(([userId, sharingConsent], i) => ({
      id: `m${i}`,
      gameId: 'g1',
      userId,
      teamId: i < 2 ? 'A' : 'B',
      role: 'member' as const,
      returnCheckins: {},
      ...(sharingConsent === undefined ? {} : { sharingConsent }),
    }));
    await games.save(makeGame({ photos: [photo('o0', 'A'), photo('c0', 'B')], memberships }));
  }

  const card = (sharerUserId = 'a1') =>
    createShareCard(games, {
      gameId: 'g1',
      sharerUserId,
      originalPhotoId: 'o0',
      chasePhotoId: 'c0',
      scoreStamp: 'Best match!',
    });

  it('builds a card when everyone depicted consented', async () => {
    await seedWithConsent({ a1: true, a2: true, b1: true, b2: true });
    const built = await unwrap(card());
    expect(built.status).toBe('active');
    // The sharer's own referral code rides the link, not one they supplied.
    expect(built.shareUrl).toContain(issueReferralCode('a1').code);
  });

  it('refuses while one depicted player has not consented', async () => {
    await seedWithConsent({ a1: true, a2: true, b1: true, b2: false });
    expect((await card()).ok).toBe(false);
  });

  it('treats never-asked as withheld, not as consent', async () => {
    // The failure mode is publishing someone who said no, so silence is a no.
    await seedWithConsent({ a1: true, a2: true, b1: true, b2: undefined });
    expect((await card()).ok).toBe(false);
  });

  it('counts every member of a depicted team, not just the shooter', async () => {
    // Nothing can tell who is actually in frame, so the whole team counts.
    await seedWithConsent({ a1: true, a2: false, b1: true, b2: true });
    expect((await card()).ok).toBe(false);
  });

  it('ignores a bystander on neither depicted team', async () => {
    await seedWithConsent({ a1: true, a2: true, b1: true, b2: true });
    const game = (await games.get('g1'))!;
    game.memberships.push({ id: 'mj', gameId: 'g1', userId: 'judge', teamId: null, role: 'judge', returnCheckins: {} });
    await games.save(game);
    expect((await card()).ok).toBe(true);
  });

  it('refuses a sharer who is not in the game', async () => {
    await seedWithConsent({ a1: true, a2: true, b1: true, b2: true });
    expect((await card('stranger')).ok).toBe(false);
  });
});

describe('crediting on the results transition', () => {
  /** Inside the 90-day attribution window from the `at: 1` attributions below. */
  const FINISHED_AT = 2000;

  let games: InMemoryGameRepository;
  let refRepo: InMemoryReferralRepository;
  let entRepo: InMemoryEntitlementRepository;

  beforeEach(async () => {
    games = new InMemoryGameRepository();
    refRepo = new InMemoryReferralRepository();
    entRepo = new InMemoryEntitlementRepository();
    await games.save(
      makeGame({
        state: 'finals_voting',
        memberships: [
          { id: 'm1', gameId: 'g1', userId: 'p1', teamId: 'A', role: 'member', returnCheckins: {} },
          { id: 'm2', gameId: 'g1', userId: 'p2', teamId: 'B', role: 'member', returnCheckins: {} },
        ],
      }),
    );
  });

  it('pays every player’s referrer when the game reaches results', async () => {
    await unwrap(attributeReferral(refRepo, { referrerUserId: 'r1', inviteeUserId: 'p1', at: 1 }));
    await unwrap(attributeReferral(refRepo, { referrerUserId: 'r2', inviteeUserId: 'p2', at: 1 }));

    const advanced = await unwrap(
      advanceGameWithRewards(
        games,
        refRepo,
        entRepo,
        { gameId: 'g1', hostUserId: 'host', event: 'COMPLETE_FINALS' },
        () => FINISHED_AT,
      ),
    );
    expect(advanced.state).toBe('results');
    expect((await entRepo.getOrCreate('r1')).gameCredits).toBe(1);
    expect((await entRepo.getOrCreate('r2')).gameCredits).toBe(1);
  });

  it('pays nobody on a transition that is not the finish', async () => {
    await games.save(makeGame({ state: 'rating', memberships: (await games.get('g1'))!.memberships }));
    await unwrap(attributeReferral(refRepo, { referrerUserId: 'r1', inviteeUserId: 'p1', at: 1 }));

    await unwrap(
      advanceGameWithRewards(
        games,
        refRepo,
        entRepo,
        { gameId: 'g1', hostUserId: 'host', event: 'COMPLETE_RATING' },
        () => FINISHED_AT,
      ),
    );
    expect((await entRepo.getOrCreate('r1')).gameCredits).toBe(0);
  });

  it('pays nothing at all when the transition is refused', async () => {
    await unwrap(attributeReferral(refRepo, { referrerUserId: 'r1', inviteeUserId: 'p1', at: 1 }));

    const result = await advanceGameWithRewards(games, refRepo, entRepo, {
      gameId: 'g1',
      hostUserId: 'host',
      event: 'END_ROUND1',
    });
    expect(result.ok).toBe(false);
    expect((await entRepo.getOrCreate('r1')).gameCredits).toBe(0);
  });

  it('does not pay twice if the finish is replayed', async () => {
    await unwrap(attributeReferral(refRepo, { referrerUserId: 'r1', inviteeUserId: 'p1', at: 1 }));
    await unwrap(
      advanceGameWithRewards(
        games,
        refRepo,
        entRepo,
        { gameId: 'g1', hostUserId: 'host', event: 'COMPLETE_FINALS' },
        () => FINISHED_AT,
      ),
    );
    await unwrap(creditReferralsForFinishedGame(games, refRepo, entRepo, { gameId: 'g1', finishedAt: FINISHED_AT }));

    expect((await entRepo.getOrCreate('r1')).gameCredits).toBe(1);
  });

  it('refuses only the host to advance, so a player cannot force a payout', async () => {
    const result = await advanceGameWithRewards(games, refRepo, entRepo, {
      gameId: 'g1',
      hostUserId: 'p1',
      event: 'COMPLETE_FINALS',
    });
    expect(result.ok).toBe(false);
  });
});

describe('setSharingConsent', () => {
  let games: InMemoryGameRepository;
  beforeEach(async () => {
    games = new InMemoryGameRepository();
    await games.save(
      makeGame({
        memberships: [{ id: 'm1', gameId: 'g1', userId: 'u1', teamId: 'A', role: 'member', returnCheckins: {} }],
      }),
    );
  });

  it('records a yes on the caller\u2019s own membership', async () => {
    await unwrap(setSharingConsent(games, { gameId: 'g1', userId: 'u1', consent: true }));
    expect((await games.get('g1'))!.memberships[0]!.sharingConsent).toBe(true);
  });

  it('lets a yes be withdrawn', async () => {
    await unwrap(setSharingConsent(games, { gameId: 'g1', userId: 'u1', consent: true }));
    await unwrap(setSharingConsent(games, { gameId: 'g1', userId: 'u1', consent: false }));
    expect((await games.get('g1'))!.memberships[0]!.sharingConsent).toBe(false);
  });

  it('refuses someone outside the game', async () => {
    expect((await setSharingConsent(games, { gameId: 'g1', userId: 'nobody', consent: true })).ok).toBe(false);
  });
});
