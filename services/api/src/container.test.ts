import { describe, expect, it } from 'vitest';
import { buildContainer } from './container.js';
import { DynamoDBReferralRepository } from './dynamodb-referral-repository.js';
import { DynamoDBGameRepository } from './dynamodb-repository.js';
import {
  DynamoDBAiJudgingRepository,
  DynamoDBEntitlementRepository,
  DynamoDBTournamentRepository,
} from './dynamodb-supporting-repos.js';
import { InMemoryEntitlementRepository } from './entitlements-repo.js';
import { InMemoryAiJudgingRepository, InMemoryReferralRepository } from './growth-repo.js';
import { S3MediaService } from './media.js';
import { InMemoryGameRepository } from './repository.js';
import { InMemoryTournamentRepository } from './tournament-repo.js';

describe('buildContainer', () => {
  it('uses DynamoDB for every repository when TABLE_NAME is set', () => {
    const c = buildContainer({ TABLE_NAME: 'photochase_dev', DYNAMODB_ENDPOINT: 'http://localhost:8000' } as NodeJS.ProcessEnv);
    expect(c.games).toBeInstanceOf(DynamoDBGameRepository);
    expect(c.entitlements).toBeInstanceOf(DynamoDBEntitlementRepository);
    expect(c.referrals).toBeInstanceOf(DynamoDBReferralRepository);
    expect(c.ai).toBeInstanceOf(DynamoDBAiJudgingRepository);
    expect(c.tournaments).toBeInstanceOf(DynamoDBTournamentRepository);
    expect(c.media).toBeInstanceOf(S3MediaService);
  });

  it('uses in-memory for every repository without TABLE_NAME', () => {
    const c = buildContainer({} as NodeJS.ProcessEnv);
    expect(c.games).toBeInstanceOf(InMemoryGameRepository);
    expect(c.entitlements).toBeInstanceOf(InMemoryEntitlementRepository);
    expect(c.referrals).toBeInstanceOf(InMemoryReferralRepository);
    expect(c.ai).toBeInstanceOf(InMemoryAiJudgingRepository);
    expect(c.tournaments).toBeInstanceOf(InMemoryTournamentRepository);
    expect(c.media).toBeInstanceOf(S3MediaService);
  });
});
