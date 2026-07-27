import type { GameConfig } from '../config/schema.js';
import type { GameMode, GameState, Tier } from '../domain/enums.js';
import type { HuntItem } from '../modes/scavenger/items.js';
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
  /**
   * Finals-phase votes (best-overall and special categories). Optional so games
   * persisted before finals shipped still load.
   */
  finalsVotes?: FinalsVoteRecord[];
  /**
   * When each round began, for return-duration scoring. Optional so games
   * persisted before check-ins shipped still load.
   */
  roundStartedAt?: Partial<Record<'round1' | 'round2', number>>;
  /** Scavenger Hunt: the list every team is hunting, generated at creation. */
  hunt?: HuntState;
  createdAt: number;
}

/**
 * The list a scavenger hunt is played against. Generated once at creation from
 * the game's seed, so every team hunts the same items.
 */
export interface HuntState {
  items: HuntItem[];
  /** An extra item revealed mid-round, worth double. */
  wildcardItemId?: string;
  /** Epoch ms the wildcard becomes visible; before this it is withheld. */
  wildcardRevealAt?: number;
}

/** One player's finals vote for a category. One vote per voter per category. */
export interface FinalsVoteRecord {
  voterUserId: string;
  /** BEST_OVERALL_CATEGORY, a preset id, or a custom category name. */
  category: string;
  teamId: string;
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
  // Color Hunt: the guessing window closes and answers are locked in.
  | { type: 'CLOSE_GUESSING' }
  // Photo Tag: the hiding window ends, then live play ends.
  | { type: 'END_SCATTER' }
  | { type: 'END_TAG' }
  | { type: 'ARCHIVE' };

export type TransitionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };

const MIN_TEAMS = 2;
const MAX_TEAMS = 6;

/** One mode's happy-path flow: event → required source state and successor. */
type ModeTable = Partial<Record<GameEvent['type'], { from: GameState; to: GameState }>>;

/**
 * Each mode is its own linear flow. Modes share event names where the meaning
 * matches — every mode opens a lobby and archives at the end — but they differ
 * in the middle, which is exactly why the table is keyed by mode.
 */
const TABLES: Record<GameMode, ModeTable> = {
  /** Shoot originals, chase them back, rate, vote finals. */
  photo_chase: {
    OPEN_LOBBY: { from: 'draft', to: 'lobby' },
    START_GAME: { from: 'lobby', to: 'round1_active' },
    END_ROUND1: { from: 'round1_active', to: 'round1_return' },
    COMPLETE_RETURN1: { from: 'round1_return', to: 'round2_active' },
    END_ROUND2: { from: 'round2_active', to: 'round2_return' },
    COMPLETE_RETURN2: { from: 'round2_return', to: 'rating' },
    COMPLETE_RATING: { from: 'rating', to: 'finals_voting' },
    COMPLETE_FINALS: { from: 'finals_voting', to: 'results' },
    ARCHIVE: { from: 'results', to: 'archived' },
  },

  /**
   * Chase minus Round 2: one hunt, then straight to judging. Reuses Round 1 and
   * its return check-in, so first team back still earns the time bonus.
   */
  scavenger_hunt: {
    OPEN_LOBBY: { from: 'draft', to: 'lobby' },
    START_GAME: { from: 'lobby', to: 'round1_active' },
    END_ROUND1: { from: 'round1_active', to: 'round1_return' },
    COMPLETE_RETURN1: { from: 'round1_return', to: 'rating' },
    COMPLETE_RATING: { from: 'rating', to: 'finals_voting' },
    COMPLETE_FINALS: { from: 'finals_voting', to: 'results' },
    ARCHIVE: { from: 'results', to: 'archived' },
  },

  /** Shoot a secret attribute, then the other team studies and guesses. */
  color_hunt: {
    OPEN_LOBBY: { from: 'draft', to: 'lobby' },
    START_GAME: { from: 'lobby', to: 'round1_active' },
    END_ROUND1: { from: 'round1_active', to: 'guessing' },
    CLOSE_GUESSING: { from: 'guessing', to: 'rating' },
    COMPLETE_RATING: { from: 'rating', to: 'results' },
    ARCHIVE: { from: 'results', to: 'archived' },
  },

  /** Scatter, then live play until the end condition; finals is the highlight reel. */
  photo_tag: {
    OPEN_LOBBY: { from: 'draft', to: 'lobby' },
    START_GAME: { from: 'lobby', to: 'scatter' },
    END_SCATTER: { from: 'scatter', to: 'tag_active' },
    END_TAG: { from: 'tag_active', to: 'finals_voting' },
    COMPLETE_FINALS: { from: 'finals_voting', to: 'results' },
    ARCHIVE: { from: 'results', to: 'archived' },
  },
};

/** The mode a game is playing; games persisted before modes shipped are chases. */
export function modeOf(game: Game): GameMode {
  return game.config.mode ?? 'photo_chase';
}

/**
 * Pure state-machine transition. Validates that the event is legal from the
 * current state and that any guards pass, returning the next state or an error.
 * Callers apply side effects (assignment, scoring) separately.
 */
export function nextState(game: Game, event: GameEvent): TransitionResult {
  const mode = modeOf(game);
  const rule = TABLES[mode][event.type];
  if (!rule) {
    return { ok: false, error: `Event ${event.type} is not part of the ${mode} flow.` };
  }
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
