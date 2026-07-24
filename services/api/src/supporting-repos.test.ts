import { InMemoryEntitlementRepository } from './entitlements-repo.js';
import { InMemoryAiJudgingRepository, InMemoryReferralRepository } from './growth-repo.js';
import { InMemoryTournamentRepository } from './tournament-repo.js';
import {
  aiJudgingRepositoryContract,
  entitlementRepositoryContract,
  referralRepositoryContract,
  tournamentRepositoryContract,
} from './repo-contracts.js';

// The in-memory implementations must satisfy the same contracts as DynamoDB.
entitlementRepositoryContract('InMemoryEntitlementRepository', () => new InMemoryEntitlementRepository());
referralRepositoryContract('InMemoryReferralRepository', () => new InMemoryReferralRepository());
aiJudgingRepositoryContract('InMemoryAiJudgingRepository', () => new InMemoryAiJudgingRepository());
tournamentRepositoryContract('InMemoryTournamentRepository', () => new InMemoryTournamentRepository());
