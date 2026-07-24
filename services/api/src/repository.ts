import type { Game } from '@photochase/shared';

/**
 * Persistence port for games. Phase 1 ships an in-memory implementation for
 * tests and local dev; a DynamoDB single-table implementation lands in a later
 * phase behind this same interface.
 */
export interface GameRepository {
  save(game: Game): Promise<void>;
  get(id: string): Promise<Game | null>;
  getByCode(code: string): Promise<Game | null>;
}

export class InMemoryGameRepository implements GameRepository {
  private readonly byId = new Map<string, Game>();
  private readonly codeToId = new Map<string, string>();

  async save(game: Game): Promise<void> {
    this.byId.set(game.id, game);
    this.codeToId.set(game.code, game.id);
  }

  async get(id: string): Promise<Game | null> {
    return this.byId.get(id) ?? null;
  }

  async getByCode(code: string): Promise<Game | null> {
    const id = this.codeToId.get(code);
    return id ? (this.byId.get(id) ?? null) : null;
  }
}
