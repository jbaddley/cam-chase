import { freeEntitlement, type AiJudgement, type Entitlement } from '@photochase/shared';
import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { EntitlementRepository } from './entitlements-repo.js';
import type { AiJudgingRepository } from './growth-repo.js';
import type { Tournament, TournamentRepository } from './tournament-repo.js';

/**
 * DynamoDB implementations of the supporting repositories, co-located on the
 * single table by key prefix (docs/02). Each stores its aggregate as one item.
 */
export interface SupportingRepoConfig {
  tableName: string;
  client: DynamoDBDocumentClient;
}

const userKey = (userId: string) => ({ pk: `USER#${userId}`, sk: 'ENTITLEMENT' });
const aiKey = (gameId: string) => ({ pk: `GAME#${gameId}`, sk: 'AIJUDGEMENTS' });
const tourneyKey = (id: string) => ({ pk: `TOURNEY#${id}`, sk: 'TOURNEY' });
/** Code → id pointer, so a league is reachable by the code it is shared by. */
const tourneyCodeKey = (code: string) => ({ pk: `TOURNEYCODE#${code}`, sk: 'POINTER' });

export class DynamoDBEntitlementRepository implements EntitlementRepository {
  constructor(private readonly cfg: SupportingRepoConfig) {}

  async get(userId: string): Promise<Entitlement | null> {
    const res = await this.cfg.client.send(new GetCommand({ TableName: this.cfg.tableName, Key: userKey(userId) }));
    return (res.Item?.entitlement as Entitlement | undefined) ?? null;
  }

  async save(entitlement: Entitlement): Promise<void> {
    await this.cfg.client.send(
      new PutCommand({ TableName: this.cfg.tableName, Item: { ...userKey(entitlement.userId), entity: 'entitlement', entitlement } }),
    );
  }

  async getOrCreate(userId: string): Promise<Entitlement> {
    const existing = await this.get(userId);
    if (existing) return existing;
    const created = freeEntitlement(userId);
    await this.save(created);
    return created;
  }
}

export class DynamoDBAiJudgingRepository implements AiJudgingRepository {
  constructor(private readonly cfg: SupportingRepoConfig) {}

  async save(gameId: string, judgements: AiJudgement[]): Promise<void> {
    await this.cfg.client.send(
      new PutCommand({ TableName: this.cfg.tableName, Item: { ...aiKey(gameId), entity: 'ai', judgements } }),
    );
  }

  async get(gameId: string): Promise<AiJudgement[] | null> {
    const res = await this.cfg.client.send(new GetCommand({ TableName: this.cfg.tableName, Key: aiKey(gameId) }));
    return (res.Item?.judgements as AiJudgement[] | undefined) ?? null;
  }
}

export class DynamoDBTournamentRepository implements TournamentRepository {
  constructor(private readonly cfg: SupportingRepoConfig) {}

  async save(tournament: Tournament): Promise<void> {
    await this.cfg.client.send(
      new PutCommand({ TableName: this.cfg.tableName, Item: { ...tourneyKey(tournament.id), entity: 'tournament', tournament } }),
    );
    // The pointer holds only the id: a league's results change every game, and
    // duplicating them here would leave two copies to drift apart.
    await this.cfg.client.send(
      new PutCommand({
        TableName: this.cfg.tableName,
        Item: { ...tourneyCodeKey(tournament.code), entity: 'tournament_code', tournamentId: tournament.id },
      }),
    );
  }

  async get(id: string): Promise<Tournament | null> {
    const res = await this.cfg.client.send(new GetCommand({ TableName: this.cfg.tableName, Key: tourneyKey(id) }));
    return (res.Item?.tournament as Tournament | undefined) ?? null;
  }

  async getByCode(code: string): Promise<Tournament | null> {
    const res = await this.cfg.client.send(
      new GetCommand({ TableName: this.cfg.tableName, Key: tourneyCodeKey(code) }),
    );
    const id = res.Item?.tournamentId as string | undefined;
    return id ? this.get(id) : null;
  }
}
