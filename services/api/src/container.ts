import { DynamoDBGameRepository, makeDynamoDocumentClient } from './dynamodb-repository.js';
import { InMemoryEntitlementRepository, type EntitlementRepository } from './entitlements-repo.js';
import {
  InMemoryAiJudgingRepository,
  InMemoryReferralRepository,
  type AiJudgingRepository,
  type ReferralRepository,
} from './growth-repo.js';
import { InMemoryGameRepository, type GameRepository } from './repository.js';
import { InMemoryTournamentRepository, type TournamentRepository } from './tournament-repo.js';

/** All repositories the API handlers depend on. */
export interface Container {
  games: GameRepository;
  entitlements: EntitlementRepository;
  referrals: ReferralRepository;
  ai: AiJudgingRepository;
  tournaments: TournamentRepository;
}

/**
 * Composition root. Selects the game repository from the environment: the
 * DynamoDB implementation when `TABLE_NAME` is set (with an optional
 * `DYNAMODB_ENDPOINT` for local emulators), otherwise the in-memory one.
 *
 * The other repositories are in-memory for now — a documented follow-up gives
 * entitlements/referrals/AI/tournaments their own DynamoDB implementations. Note
 * that in-memory state does not survive Lambda cold starts, so only games are
 * durably persisted today.
 */
export function buildContainer(env: NodeJS.ProcessEnv = process.env): Container {
  const games: GameRepository = env.TABLE_NAME
    ? new DynamoDBGameRepository({
        tableName: env.TABLE_NAME,
        client: makeDynamoDocumentClient({ endpoint: env.DYNAMODB_ENDPOINT, region: env.AWS_REGION }),
      })
    : new InMemoryGameRepository();

  return {
    games,
    entitlements: new InMemoryEntitlementRepository(),
    referrals: new InMemoryReferralRepository(),
    ai: new InMemoryAiJudgingRepository(),
    tournaments: new InMemoryTournamentRepository(),
  };
}
