import { InMemoryEntitlementRepository } from './entitlements-repo.js';
import { InMemoryAiJudgingRepository, InMemoryReferralRepository } from './growth-repo.js';
import { InMemoryProfileRepository } from './profile-repo.js';
import { InMemoryDailyHuntRepository, InMemoryTournamentRepository } from './tournament-repo.js';
import {
  aiJudgingRepositoryContract,
  entitlementRepositoryContract,
  profileRepositoryContract,
  referralRepositoryContract,
  dailyHuntRepositoryContract,
  tournamentRepositoryContract,
} from './repo-contracts.js';

// The in-memory implementations must satisfy the same contracts as DynamoDB.
entitlementRepositoryContract('InMemoryEntitlementRepository', () => new InMemoryEntitlementRepository());
profileRepositoryContract('InMemoryProfileRepository', () => new InMemoryProfileRepository());
referralRepositoryContract('InMemoryReferralRepository', () => new InMemoryReferralRepository());
aiJudgingRepositoryContract('InMemoryAiJudgingRepository', () => new InMemoryAiJudgingRepository());
tournamentRepositoryContract('InMemoryTournamentRepository', () => new InMemoryTournamentRepository());
dailyHuntRepositoryContract('InMemoryDailyHuntRepository', () => new InMemoryDailyHuntRepository());
