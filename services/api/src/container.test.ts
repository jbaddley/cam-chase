import { describe, expect, it } from 'vitest';
import { buildContainer } from './container.js';
import { DynamoDBGameRepository } from './dynamodb-repository.js';
import { InMemoryGameRepository } from './repository.js';

describe('buildContainer', () => {
  it('uses the DynamoDB game repository when TABLE_NAME is set', () => {
    const container = buildContainer({ TABLE_NAME: 'photochase_dev', DYNAMODB_ENDPOINT: 'http://localhost:8000' } as NodeJS.ProcessEnv);
    expect(container.games).toBeInstanceOf(DynamoDBGameRepository);
  });

  it('falls back to the in-memory game repository without TABLE_NAME', () => {
    const container = buildContainer({} as NodeJS.ProcessEnv);
    expect(container.games).toBeInstanceOf(InMemoryGameRepository);
  });

  it('always provides the supporting repositories', () => {
    const container = buildContainer({} as NodeJS.ProcessEnv);
    expect(container.entitlements).toBeDefined();
    expect(container.referrals).toBeDefined();
    expect(container.ai).toBeDefined();
    expect(container.tournaments).toBeDefined();
  });
});
