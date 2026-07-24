import type { AiJudgement, Referral } from '@photochase/shared';

/** Month key (YYYY-MM) used for the referrer monthly credit cap. */
export function monthKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 7);
}

export interface ReferralRepository {
  save(referral: Referral): Promise<void>;
  findByInvitee(inviteeUserId: string): Promise<Referral | null>;
  countCreditedForReferrerInMonth(referrerUserId: string, month: string): Promise<number>;
}

export class InMemoryReferralRepository implements ReferralRepository {
  private readonly referrals: Referral[] = [];

  async save(referral: Referral): Promise<void> {
    const idx = this.referrals.findIndex((r) => r.inviteeUserId === referral.inviteeUserId);
    if (idx >= 0) this.referrals[idx] = referral;
    else this.referrals.push(referral);
  }

  async findByInvitee(inviteeUserId: string): Promise<Referral | null> {
    return this.referrals.find((r) => r.inviteeUserId === inviteeUserId) ?? null;
  }

  async countCreditedForReferrerInMonth(referrerUserId: string, month: string): Promise<number> {
    return this.referrals.filter(
      (r) =>
        r.referrerUserId === referrerUserId &&
        r.credited &&
        r.activatedAt !== undefined &&
        monthKey(r.activatedAt) === month,
    ).length;
  }
}

/** Stores AI judgements per game (a later phase moves this to DynamoDB). */
export interface AiJudgingRepository {
  save(gameId: string, judgements: AiJudgement[]): Promise<void>;
  get(gameId: string): Promise<AiJudgement[] | null>;
}

export class InMemoryAiJudgingRepository implements AiJudgingRepository {
  private readonly byGame = new Map<string, AiJudgement[]>();
  async save(gameId: string, judgements: AiJudgement[]): Promise<void> {
    this.byGame.set(gameId, judgements);
  }
  async get(gameId: string): Promise<AiJudgement[] | null> {
    return this.byGame.get(gameId) ?? null;
  }
}
