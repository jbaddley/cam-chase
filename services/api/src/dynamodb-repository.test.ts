import { CreateTableCommand } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import dynalite from 'dynalite';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll } from 'vitest';
import {
  DynamoDBGameRepository,
  gameTableDefinition,
  makeDynamoDocumentClient,
} from './dynamodb-repository.js';
import { gameRepositoryContract } from './repository-contract.js';

const TABLE = 'photochase_test';
let server: Server;
let client: DynamoDBDocumentClient;

beforeAll(async () => {
  // In-process, pure-JS DynamoDB — no Docker or Java required.
  server = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  client = makeDynamoDocumentClient({ endpoint: `http://127.0.0.1:${port}` });
  await client.send(new CreateTableCommand(gameTableDefinition(TABLE)));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// The real DynamoDB implementation must satisfy the identical contract.
gameRepositoryContract('DynamoDBGameRepository', () => new DynamoDBGameRepository({ tableName: TABLE, client }));
