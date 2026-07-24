import { freeEntitlement, type Entitlement } from '@photochase/shared';

/** Persistence port for user entitlements. */
export interface EntitlementRepository {
  get(userId: string): Promise<Entitlement | null>;
  save(entitlement: Entitlement): Promise<void>;
  /** Fetch the user's entitlement, creating a free one if none exists. */
  getOrCreate(userId: string): Promise<Entitlement>;
}

export class InMemoryEntitlementRepository implements EntitlementRepository {
  private readonly byUser = new Map<string, Entitlement>();

  async get(userId: string): Promise<Entitlement | null> {
    return this.byUser.get(userId) ?? null;
  }

  async save(entitlement: Entitlement): Promise<void> {
    this.byUser.set(entitlement.userId, entitlement);
  }

  async getOrCreate(userId: string): Promise<Entitlement> {
    const existing = this.byUser.get(userId);
    if (existing) return existing;
    const created = freeEntitlement(userId);
    this.byUser.set(userId, created);
    return created;
  }
}
