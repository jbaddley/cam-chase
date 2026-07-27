import type { AiJudgement, Entitlement, Referral } from '@photochase/shared';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EntitlementRepository } from './entitlements-repo.js';
import { monthKey, type AiJudgingRepository, type ReferralRepository } from './growth-repo.js';
import type { Tournament, TournamentRepository } from './tournament-repo.js';

const uid = (prefix: string) => `${prefix}_${randomUUID()}`;

/** Contract for EntitlementRepository. */
export function entitlementRepositoryContract(
  name: string,
  makeRepo: () => EntitlementRepository | Promise<EntitlementRepository>,
): void {
  describe(name, () => {
    it('returns null for an unknown user', async () => {
      const repo = await makeRepo();
      expect(await repo.get(uid('user'))).toBeNull();
    });

    it('saves and reads back an entitlement', async () => {
      const repo = await makeRepo();
      const ent: Entitlement = { userId: uid('user'), tier: 'game_pack', gameCredits: 3, subscriptionActive: false };
      await repo.save(ent);
      expect(await repo.get(ent.userId)).toEqual(ent);
    });

    it('getOrCreate creates and persists a free entitlement', async () => {
      const repo = await makeRepo();
      const userId = uid('user');
      const created = await repo.getOrCreate(userId);
      expect(created).toEqual({ userId, tier: 'free', gameCredits: 0, subscriptionActive: false });
      expect(await repo.get(userId)).toEqual(created);
    });

    it('getOrCreate returns an existing entitlement unchanged', async () => {
      const repo = await makeRepo();
      const ent: Entitlement = { userId: uid('user'), tier: 'unlimited', gameCredits: 0, subscriptionActive: true, subscriptionExpiresAt: 999 };
      await repo.save(ent);
      expect(await repo.getOrCreate(ent.userId)).toEqual(ent);
    });
  });
}

/** Contract for ReferralRepository, including the monthly credited count. */
export function referralRepositoryContract(
  name: string,
  makeRepo: () => ReferralRepository | Promise<ReferralRepository>,
): void {
  describe(name, () => {
    const jan = Date.UTC(2026, 0, 15);
    const feb = Date.UTC(2026, 1, 15);

    it('returns null for an unknown invitee', async () => {
      const repo = await makeRepo();
      expect(await repo.findByInvitee(uid('u'))).toBeNull();
    });

    it('saves and finds by invitee, and overwrites', async () => {
      const repo = await makeRepo();
      const invitee = uid('inv');
      const base: Referral = { code: 'ABC123', referrerUserId: uid('ref'), inviteeUserId: invitee, attributedAt: 1, credited: false };
      await repo.save(base);
      expect(await repo.findByInvitee(invitee)).toEqual(base);
      const credited: Referral = { ...base, credited: true, activatedAt: jan };
      await repo.save(credited);
      expect(await repo.findByInvitee(invitee)).toEqual(credited);
    });

    it('counts credited referrals for a referrer within a month', async () => {
      const repo = await makeRepo();
      const referrer = uid('ref');
      await repo.save({ code: 'C1', referrerUserId: referrer, inviteeUserId: uid('inv'), attributedAt: 1, credited: true, activatedAt: jan });
      await repo.save({ code: 'C2', referrerUserId: referrer, inviteeUserId: uid('inv'), attributedAt: 1, credited: true, activatedAt: jan });
      await repo.save({ code: 'C3', referrerUserId: referrer, inviteeUserId: uid('inv'), attributedAt: 1, credited: true, activatedAt: feb });
      // An uncredited referral must not be counted.
      await repo.save({ code: 'C4', referrerUserId: referrer, inviteeUserId: uid('inv'), attributedAt: 1, credited: false });

      expect(await repo.countCreditedForReferrerInMonth(referrer, monthKey(jan))).toBe(2);
      expect(await repo.countCreditedForReferrerInMonth(referrer, monthKey(feb))).toBe(1);
      expect(await repo.countCreditedForReferrerInMonth(uid('other'), monthKey(jan))).toBe(0);
    });

    it('counts a referrer’s credited referrals across every month', async () => {
      const repo = await makeRepo();
      const referrer = uid('ref');
      await repo.save({ code: 'C1', referrerUserId: referrer, inviteeUserId: uid('inv'), attributedAt: 1, credited: true, activatedAt: jan });
      await repo.save({ code: 'C2', referrerUserId: referrer, inviteeUserId: uid('inv'), attributedAt: 1, credited: true, activatedAt: feb });
      await repo.save({ code: 'C3', referrerUserId: referrer, inviteeUserId: uid('inv'), attributedAt: 1, credited: false });

      // The reward ladder is measured in lifetime credits; the monthly count is
      // only an anti-abuse cap, so the two must not be the same number.
      expect(await repo.countCreditedForReferrer(referrer)).toBe(2);
      expect(await repo.countCreditedForReferrerInMonth(referrer, monthKey(jan))).toBe(1);
      expect(await repo.countCreditedForReferrer(uid('other'))).toBe(0);
    });

    it('resolves a registered code back to its owner', async () => {
      const repo = await makeRepo();
      const owner = uid('owner');
      await repo.registerCode('ABC123', owner);
      expect(await repo.findUserByCode('ABC123')).toBe(owner);
    });

    it('returns null for a code nobody owns', async () => {
      const repo = await makeRepo();
      expect(await repo.findUserByCode('NOSUCH')).toBeNull();
    });

    it('lets a code registration be repeated without changing the owner', async () => {
      const repo = await makeRepo();
      const owner = uid('owner');
      await repo.registerCode('ABC123', owner);
      await repo.registerCode('ABC123', owner);
      expect(await repo.findUserByCode('ABC123')).toBe(owner);
    });
  });
}

/** Contract for AiJudgingRepository. */
export function aiJudgingRepositoryContract(
  name: string,
  makeRepo: () => AiJudgingRepository | Promise<AiJudgingRepository>,
): void {
  describe(name, () => {
    const judgements: AiJudgement[] = [
      { assignmentId: 'a1', poseScore: 8, angleScore: 6, locationMatch: 10, clueVisible: true, confidence: 0.9 },
      { assignmentId: 'a2', poseScore: 3, angleScore: 5, locationMatch: 2, clueVisible: false, confidence: 0.4 },
    ];

    it('returns null before any judgements are stored', async () => {
      const repo = await makeRepo();
      expect(await repo.get(uid('game'))).toBeNull();
    });

    it('saves and reads back judgements, and overwrites', async () => {
      const repo = await makeRepo();
      const gameId = uid('game');
      await repo.save(gameId, judgements);
      expect(await repo.get(gameId)).toEqual(judgements);
      await repo.save(gameId, [judgements[0]!]);
      expect(await repo.get(gameId)).toHaveLength(1);
    });
  });
}

/** Contract for TournamentRepository. */
export function tournamentRepositoryContract(
  name: string,
  makeRepo: () => TournamentRepository | Promise<TournamentRepository>,
): void {
  describe(name, () => {
    it('returns null for an unknown tournament', async () => {
      const repo = await makeRepo();
      expect(await repo.get(uid('t'))).toBeNull();
    });

    it('saves and reads back a tournament with results, and overwrites', async () => {
      const repo = await makeRepo();
      const tournament: Tournament = {
        id: uid('tourney'),
        name: 'Summer League',
        results: [{ gameId: 'g1', placements: [{ teamKey: 'A', gamePoints: 200 }, { teamKey: 'B', gamePoints: 150 }] }],
      };
      await repo.save(tournament);
      expect(await repo.get(tournament.id)).toEqual(tournament);
      const updated: Tournament = { ...tournament, results: [...tournament.results, { gameId: 'g2', placements: [] }] };
      await repo.save(updated);
      expect((await repo.get(tournament.id))?.results).toHaveLength(2);
    });
  });
}
