import type { GameResult } from '@photochase/shared';

/**
 * A league season. Created by a paid user; anyone holding the code can attach a
 * game to it and play free, which is what makes creating one worth paying for.
 */
export interface Tournament {
  id: string;
  /** Short code shared with the league, the same shape as a game join code. */
  code: string;
  name: string;
  ownerUserId: string;
  results: GameResult[];
  createdAt: number;
}

export interface TournamentRepository {
  save(tournament: Tournament): Promise<void>;
  get(id: string): Promise<Tournament | null>;
  /** Resolve the code a league is shared by. Codes are unique. */
  getByCode(code: string): Promise<Tournament | null>;
}

export class InMemoryTournamentRepository implements TournamentRepository {
  private readonly byId = new Map<string, Tournament>();

  async save(tournament: Tournament): Promise<void> {
    this.byId.set(tournament.id, tournament);
  }

  async get(id: string): Promise<Tournament | null> {
    return this.byId.get(id) ?? null;
  }

  async getByCode(code: string): Promise<Tournament | null> {
    for (const tournament of this.byId.values()) {
      if (tournament.code === code) return tournament;
    }
    return null;
  }
}
