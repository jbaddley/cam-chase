import type { GameResult } from '@photochase/shared';

export interface Tournament {
  id: string;
  name: string;
  results: GameResult[];
}

export interface TournamentRepository {
  save(tournament: Tournament): Promise<void>;
  get(id: string): Promise<Tournament | null>;
}

export class InMemoryTournamentRepository implements TournamentRepository {
  private readonly byId = new Map<string, Tournament>();
  async save(tournament: Tournament): Promise<void> {
    this.byId.set(tournament.id, tournament);
  }
  async get(id: string): Promise<Tournament | null> {
    return this.byId.get(id) ?? null;
  }
}
