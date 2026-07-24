import { gameRepositoryContract } from './repository-contract.js';
import { InMemoryGameRepository } from './repository.js';

// The in-memory implementation must satisfy the same contract as DynamoDB.
gameRepositoryContract('InMemoryGameRepository', () => new InMemoryGameRepository());
