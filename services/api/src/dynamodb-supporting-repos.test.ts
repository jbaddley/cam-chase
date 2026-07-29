import { CreateTableCommand } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import dynalite from 'dynalite';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll } from 'vitest';
import { gameTableDefinition, makeDynamoDocumentClient } from './dynamodb-repository.js';
import {
  DynamoDBAiJudgingRepository,
  DynamoDBEntitlementRepository,
  DynamoDBDailyHuntRepository,
  DynamoDBProfileRepository,
  DynamoDBTournamentRepository,
} from './dynamodb-supporting-repos.js';
import {
  aiJudgingRepositoryContract,
  entitlementRepositoryContract,
  profileRepositoryContract,
  dailyHuntRepositoryContract,
  tournamentRepositoryContract,
} from './repo-contracts.js';

const TABLE = 'photochase_test';
let server: Server;
let client: DynamoDBDocumentClient;

beforeAll(async () => {
  server = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  client = makeDynamoDocumentClient({ endpoint: `http://127.0.0.1:${port}` });
  await client.send(new CreateTableCommand(gameTableDefinition(TABLE)));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

entitlementRepositoryContract('DynamoDBEntitlementRepository', () => new DynamoDBEntitlementRepository({ tableName: TABLE, client }));
profileRepositoryContract('DynamoDBProfileRepository', () => new DynamoDBProfileRepository({ tableName: TABLE, client }));
aiJudgingRepositoryContract('DynamoDBAiJudgingRepository', () => new DynamoDBAiJudgingRepository({ tableName: TABLE, client }));
tournamentRepositoryContract('DynamoDBTournamentRepository', () => new DynamoDBTournamentRepository({ tableName: TABLE, client }));
dailyHuntRepositoryContract('DynamoDBDailyHuntRepository', () => new DynamoDBDailyHuntRepository({ tableName: TABLE, client }));
