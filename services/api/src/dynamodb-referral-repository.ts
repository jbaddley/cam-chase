import type { Referral } from '@photochase/shared';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { monthKey, type ReferralRepository } from './growth-repo.js';
import type { SupportingRepoConfig } from './dynamodb-supporting-repos.js';

const inviteeKey = (inviteeUserId: string) => ({ pk: `INVITEE#${inviteeUserId}`, sk: 'REFERRAL' });
const codeKey = (code: string) => ({ pk: `REFCODE#${code}`, sk: 'OWNER' });

/**
 * DynamoDB referral repository. Base item at INVITEE#<id>/REFERRAL. When a
 * referral is credited it also carries sparse GSI1 keys
 * (GSI1PK=REFERRER#<id>, GSI1SK=<month>#<invitee>) so the monthly-cap count is a
 * single GSI query rather than a scan.
 */
export class DynamoDBReferralRepository implements ReferralRepository {
  constructor(private readonly cfg: SupportingRepoConfig) {}

  async save(referral: Referral): Promise<void> {
    const item: Record<string, unknown> = { ...inviteeKey(referral.inviteeUserId), entity: 'referral', referral };
    // Only credited referrals participate in the referrer's monthly count.
    if (referral.credited && referral.activatedAt !== undefined) {
      item.GSI1PK = `REFERRER#${referral.referrerUserId}`;
      item.GSI1SK = `${monthKey(referral.activatedAt)}#${referral.inviteeUserId}`;
    }
    await this.cfg.client.send(new PutCommand({ TableName: this.cfg.tableName, Item: item }));
  }

  async findByInvitee(inviteeUserId: string): Promise<Referral | null> {
    const res = await this.cfg.client.send(
      new GetCommand({ TableName: this.cfg.tableName, Key: inviteeKey(inviteeUserId) }),
    );
    return (res.Item?.referral as Referral | undefined) ?? null;
  }

  async countCreditedForReferrerInMonth(referrerUserId: string, month: string): Promise<number> {
    return this.countCredited(referrerUserId, `${month}#`);
  }

  /** Lifetime count: the same GSI partition, with no month prefix to narrow it. */
  async countCreditedForReferrer(referrerUserId: string): Promise<number> {
    return this.countCredited(referrerUserId);
  }

  private async countCredited(referrerUserId: string, sortPrefix?: string): Promise<number> {
    const res = await this.cfg.client.send(
      new QueryCommand({
        TableName: this.cfg.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: sortPrefix
          ? 'GSI1PK = :pk AND begins_with(GSI1SK, :m)'
          : 'GSI1PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `REFERRER#${referrerUserId}`,
          ...(sortPrefix ? { ':m': sortPrefix } : {}),
        },
        Select: 'COUNT',
      }),
    );
    return res.Count ?? 0;
  }

  async registerCode(code: string, userId: string): Promise<void> {
    await this.cfg.client.send(
      new PutCommand({ TableName: this.cfg.tableName, Item: { ...codeKey(code), entity: 'referral_code', userId } }),
    );
  }

  async findUserByCode(code: string): Promise<string | null> {
    const res = await this.cfg.client.send(
      new GetCommand({ TableName: this.cfg.tableName, Key: codeKey(code) }),
    );
    return (res.Item?.userId as string | undefined) ?? null;
  }
}
