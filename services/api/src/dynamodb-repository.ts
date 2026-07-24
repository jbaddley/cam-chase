import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { CreateTableCommandInput } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Game } from '@photochase/shared';
import type { GameRepository } from './repository.js';

/**
 * DynamoDB-backed GameRepository (docs/02 single-table design). v1 stores each
 * game as one aggregate item at `GAME#<id>` plus a `CODE#<code>` lookup item —
 * the hot path is a single game aggregate. A follow-up can split entities into
 * per-item rows for games approaching the 400 KB item limit.
 */

const gameKey = (id: string) => ({ pk: `GAME#${id}`, sk: `GAME#${id}` });
const codeKey = (code: string) => ({ pk: `CODE#${code}`, sk: `CODE#${code}` });

export interface DynamoDBGameRepositoryConfig {
  tableName: string;
  client: DynamoDBDocumentClient;
}

export class DynamoDBGameRepository implements GameRepository {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(config: DynamoDBGameRepositoryConfig) {
    this.tableName = config.tableName;
    this.client = config.client;
  }

  async save(game: Game): Promise<void> {
    await this.client.send(
      new PutCommand({ TableName: this.tableName, Item: { ...gameKey(game.id), entity: 'game', game } }),
    );
    // Immutable code → game-id lookup for the join-by-code path.
    await this.client.send(
      new PutCommand({ TableName: this.tableName, Item: { ...codeKey(game.code), entity: 'code', gameId: game.id } }),
    );
  }

  async get(id: string): Promise<Game | null> {
    const res = await this.client.send(new GetCommand({ TableName: this.tableName, Key: gameKey(id) }));
    return (res.Item?.game as Game | undefined) ?? null;
  }

  async getByCode(code: string): Promise<Game | null> {
    const res = await this.client.send(new GetCommand({ TableName: this.tableName, Key: codeKey(code) }));
    const gameId = res.Item?.gameId as string | undefined;
    return gameId ? this.get(gameId) : null;
  }
}

/**
 * Build a DynamoDB document client. Pass an `endpoint` for local emulators
 * (dynalite / DynamoDB Local); omit it in AWS to use the default credential
 * chain. `removeUndefinedValues` keeps optional fields (e.g. GeoPoint.accuracyM)
 * from breaking marshalling.
 */
export function makeDynamoDocumentClient(opts: { endpoint?: string; region?: string } = {}): DynamoDBDocumentClient {
  const endpoint = opts.endpoint ?? process.env.DYNAMODB_ENDPOINT;
  const base = new DynamoDBClient({
    region: opts.region ?? process.env.AWS_REGION ?? 'us-east-1',
    ...(endpoint
      ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
      : {}),
  });
  return DynamoDBDocumentClient.from(base, { marshallOptions: { removeUndefinedValues: true } });
}

/** Single-table definition (pk/sk, on-demand) — mirrors the CDK table. */
export function gameTableDefinition(tableName: string): CreateTableCommandInput {
  return {
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
  };
}
