import { CreateTableCommand } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import dynalite from 'dynalite';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll } from 'vitest';
import { gameTableDefinition, makeDynamoDocumentClient } from './dynamodb-repository.js';
import { DynamoDBReferralRepository } from './dynamodb-referral-repository.js';
import { referralRepositoryContract } from './repo-contracts.js';

const TABLE = 'photochase_test';
let server: Server;
let client: DynamoDBDocumentClient;

beforeAll(async () => {
  server = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  client = makeDynamoDocumentClient({ endpoint: `http://127.0.0.1:${port}` });
  // Table includes GSI1, which the monthly-cap query depends on.
  await client.send(new CreateTableCommand(gameTableDefinition(TABLE)));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

referralRepositoryContract('DynamoDBReferralRepository', () => new DynamoDBReferralRepository({ tableName: TABLE, client }));
