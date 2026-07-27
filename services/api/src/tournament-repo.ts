import type { GameMode, GameResult } from '@photochase/shared';

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
  /**
   * A gauntlet: a fixed sequence of modes played back to back, scored by
   * combined game points rather than placement. Absent for an ordinary league,
   * which is open-ended and placement-scored.
   */
  legModes?: GameMode[];
  /** Gauntlet only: scale the final leg for teams trailing after the others. */
  catchUp?: boolean;
  createdAt: number;
}

/** A finished gauntlet leg, kept so the combined table can be rebuilt. */
export interface DailyHuntRepository {
  /** The game id of this user's run for a date key, if they started one. */
  get(userId: string, dateKey: string): Promise<string | null>;
  set(userId: string, dateKey: string, gameId: string): Promise<void>;
}

export class InMemoryDailyHuntRepository implements DailyHuntRepository {
  private readonly byUserDay = new Map<string, string>();
  private key = (userId: string, dateKey: string) => `${userId}::${dateKey}`;

  async get(userId: string, dateKey: string): Promise<string | null> {
    return this.byUserDay.get(this.key(userId, dateKey)) ?? null;
  }

  async set(userId: string, dateKey: string, gameId: string): Promise<void> {
    this.byUserDay.set(this.key(userId, dateKey), gameId);
  }
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
