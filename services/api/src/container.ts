import { DynamoDBGameRepository, makeDynamoDocumentClient } from './dynamodb-repository.js';
import { DynamoDBReferralRepository } from './dynamodb-referral-repository.js';
import {
  DynamoDBAiJudgingRepository,
  DynamoDBEntitlementRepository,
  DynamoDBTournamentRepository,
} from './dynamodb-supporting-repos.js';
import { InMemoryEntitlementRepository, type EntitlementRepository } from './entitlements-repo.js';
import {
  InMemoryAiJudgingRepository,
  InMemoryReferralRepository,
  type AiJudgingRepository,
  type ReferralRepository,
} from './growth-repo.js';
import { verifierFromEnv, type TokenVerifier } from './auth.js';
import { consoleSink, Logger, noopSink } from './logger.js';
import { makeS3Client, S3MediaService, type MediaService } from './media.js';
import { InMemoryGameRepository, type GameRepository } from './repository.js';
import { InMemoryTournamentRepository, type TournamentRepository } from './tournament-repo.js';

/** Everything the API handlers depend on. */
export interface Container {
  games: GameRepository;
  entitlements: EntitlementRepository;
  referrals: ReferralRepository;
  ai: AiJudgingRepository;
  tournaments: TournamentRepository;
  media: MediaService;
  /** JWT verifier for the bearer-token fallback; undefined if Cognito isn't configured. */
  verifier?: TokenVerifier;
  logger: Logger;
}

/**
 * Composition root. When `TABLE_NAME` is set, every repository is backed by the
 * DynamoDB single table (sharing one document client; optional
 * `DYNAMODB_ENDPOINT` targets a local emulator). Otherwise everything is
 * in-memory (local dev / tests).
 */
export function buildContainer(env: NodeJS.ProcessEnv = process.env): Container {
  // Photo media is always S3-backed (presigning is offline; the S3 client
  // resolves credentials lazily). S3_ENDPOINT targets a local emulator.
  const media = new S3MediaService(
    makeS3Client({ region: env.AWS_REGION, endpoint: env.S3_ENDPOINT }),
    env.PHOTO_BUCKET ?? 'photochase-local',
  );
  const verifier = verifierFromEnv(env);
  // Silence logs under Vitest; JSON to stdout (CloudWatch) otherwise.
  const logger = new Logger(process.env.VITEST ? noopSink : consoleSink, { service: 'photochase-api' });

  if (env.TABLE_NAME) {
    const cfg = {
      tableName: env.TABLE_NAME,
      client: makeDynamoDocumentClient({ endpoint: env.DYNAMODB_ENDPOINT, region: env.AWS_REGION }),
    };
    return {
      games: new DynamoDBGameRepository(cfg),
      entitlements: new DynamoDBEntitlementRepository(cfg),
      referrals: new DynamoDBReferralRepository(cfg),
      ai: new DynamoDBAiJudgingRepository(cfg),
      tournaments: new DynamoDBTournamentRepository(cfg),
      media,
      verifier,
      logger,
    };
  }

  return {
    games: new InMemoryGameRepository(),
    entitlements: new InMemoryEntitlementRepository(),
    referrals: new InMemoryReferralRepository(),
    ai: new InMemoryAiJudgingRepository(),
    tournaments: new InMemoryTournamentRepository(),
    media,
    verifier,
    logger,
  };
}
