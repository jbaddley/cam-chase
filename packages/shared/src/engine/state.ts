import type { GameConfig } from '../config/schema.js';
import type { GameState, Tier } from '../domain/enums.js';
import type {
  Assignment,
  Membership,
  Photo,
  Team,
  Vote,
} from '../domain/types.js';

/** The full in-memory game aggregate the engine operates on. */
export interface Game {
  id: string;
  hostUserId: string;
  /** Short join code shown as text and QR in the lobby. */
  code: string;
  tier: Tier;
  config: GameConfig;
  state: GameState;
  teams: Team[];
  memberships: Membership[];
  photos: Photo[];
  assignments: Assignment[];
  votes: Vote[];
  createdAt: number;
}

/** Events that drive the game forward. Most are host-issued or timer-issued. */
export type GameEvent =
  | { type: 'OPEN_LOBBY' }
  | { type: 'START_GAME' }
  | { type: 'END_ROUND1' }
  | { type: 'COMPLETE_RETURN1' }
  | { type: 'END_ROUND2' }
  | { type: 'COMPLETE_RETURN2' }
  | { type: 'COMPLETE_RATING' }
  | { type: 'COMPLETE_FINALS' }
  | { type: 'ARCHIVE' };

export type TransitionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };

const MIN_TEAMS = 2;
const MAX_TEAMS = 6;

/** Linear happy-path successor for each event, keyed by required source state. */
const TABLE: Record<GameEvent['type'], { from: GameState; to: GameState }> = {
  OPEN_LOBBY: { from: 'draft', to: 'lobby' },
  START_GAME: { from: 'lobby', to: 'round1_active' },
  END_ROUND1: { from: 'round1_active', to: 'round1_return' },
  COMPLETE_RETURN1: { from: 'round1_return', to: 'round2_active' },
  END_ROUND2: { from: 'round2_active', to: 'round2_return' },
  COMPLETE_RETURN2: { from: 'round2_return', to: 'rating' },
  COMPLETE_RATING: { from: 'rating', to: 'finals_voting' },
  COMPLETE_FINALS: { from: 'finals_voting', to: 'results' },
  ARCHIVE: { from: 'results', to: 'archived' },
};

/**
 * Pure state-machine transition. Validates that the event is legal from the
 * current state and that any guards pass, returning the next state or an error.
 * Callers apply side effects (assignment, scoring) separately.
 */
export function nextState(game: Game, event: GameEvent): TransitionResult {
  const rule = TABLE[event.type];
  if (game.state !== rule.from) {
    return {
      ok: false,
      error: `Cannot ${event.type} from state "${game.state}"; requires "${rule.from}".`,
    };
  }

  if (event.type === 'START_GAME') {
    const teamCount = game.teams.length;
    if (teamCount < MIN_TEAMS) {
      return { ok: false, error: `Need at least ${MIN_TEAMS} teams to start (have ${teamCount}).` };
    }
    if (teamCount > MAX_TEAMS) {
      return { ok: false, error: `At most ${MAX_TEAMS} teams allowed (have ${teamCount}).` };
    }
    if (teamCount > game.config.maxTeams) {
      return {
        ok: false,
        error: `Config allows ${game.config.maxTeams} teams (have ${teamCount}).`,
      };
    }
  }

  return { ok: true, state: rule.to };
}

/** Convenience wrapper that returns a new Game with the transitioned state. */
export function applyTransition(game: Game, event: GameEvent): Game {
  const result = nextState(game, event);
  if (!result.ok) throw new Error(result.error);
  return { ...game, state: result.state };
}
