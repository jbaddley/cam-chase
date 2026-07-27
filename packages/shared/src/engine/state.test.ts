import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config/schema.js';
import type { Team } from '../domain/types.js';
import type { GameMode } from '../domain/enums.js';
import { applyTransition, modeOf, nextState, type Game, type GameEvent } from './state.js';

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    hostUserId: 'u1',
    code: 'ABC123',
    tier: 'game_pack',
    config: DEFAULT_CONFIG,
    state: 'draft',
    teams: [],
    memberships: [],
    photos: [],
    assignments: [],
    votes: [],
    createdAt: 0,
    ...overrides,
  };
}

function team(id: string): Team {
  return { id, gameId: 'g1', name: id, createdAt: 0 };
}

const HAPPY_PATH: Array<[GameEvent['type'], string]> = [
  ['OPEN_LOBBY', 'lobby'],
  ['START_GAME', 'round1_active'],
  ['END_ROUND1', 'round1_return'],
  ['COMPLETE_RETURN1', 'round2_active'],
  ['END_ROUND2', 'round2_return'],
  ['COMPLETE_RETURN2', 'rating'],
  ['COMPLETE_RATING', 'finals_voting'],
  ['COMPLETE_FINALS', 'results'],
  ['ARCHIVE', 'archived'],
];

describe('nextState — happy path', () => {
  it('walks the full lifecycle in order', () => {
    let game = makeGame({ teams: [team('a'), team('b')] });
    for (const [type, expected] of HAPPY_PATH) {
      game = applyTransition(game, { type } as GameEvent);
      expect(game.state).toBe(expected);
    }
  });
});

describe('nextState — illegal transitions', () => {
  it('rejects an event from the wrong source state', () => {
    const game = makeGame({ state: 'draft', teams: [team('a'), team('b')] });
    const result = nextState(game, { type: 'START_GAME' });
    expect(result.ok).toBe(false);
  });

  it('rejects rating before round2_return', () => {
    const game = makeGame({ state: 'round2_active' });
    expect(nextState(game, { type: 'COMPLETE_RETURN2' }).ok).toBe(false);
  });

  it('applyTransition throws on illegal transitions', () => {
    const game = makeGame({ state: 'results' });
    expect(() => applyTransition(game, { type: 'START_GAME' })).toThrow();
  });
});

describe('nextState — START_GAME guards', () => {
  it('rejects starting with fewer than 2 teams', () => {
    const game = makeGame({ state: 'lobby', teams: [team('a')] });
    const result = nextState(game, { type: 'START_GAME' });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/at least 2 teams/);
  });

  it('rejects starting with more than 6 teams', () => {
    const teams = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(team);
    const game = makeGame({ state: 'lobby', teams, config: { ...DEFAULT_CONFIG, maxTeams: 6 } });
    expect(nextState(game, { type: 'START_GAME' }).ok).toBe(false);
  });

  it('rejects exceeding the configured team cap', () => {
    const teams = ['a', 'b', 'c'].map(team);
    const game = makeGame({ state: 'lobby', teams, config: { ...DEFAULT_CONFIG, maxTeams: 2 } });
    expect(nextState(game, { type: 'START_GAME' }).ok).toBe(false);
  });

  it('allows starting with exactly 2 teams', () => {
    const game = makeGame({ state: 'lobby', teams: [team('a'), team('b')] });
    expect(nextState(game, { type: 'START_GAME' })).toEqual({ ok: true, state: 'round1_active' });
  });
});

describe('mode-scoped flows', () => {
  /** A game in the given mode and state, with enough teams to start. */
  function inMode(mode: GameMode, state: Game['state']): Game {
    return makeGame({
      config: { ...DEFAULT_CONFIG, mode },
      state,
      teams: [team('a'), team('b')],
    });
  }

  /** Walk a sequence of events, asserting each lands on the expected state. */
  function walk(mode: GameMode, steps: Array<[GameEvent['type'], Game['state']]>): void {
    let game = inMode(mode, 'draft');
    for (const [type, expected] of steps) {
      game = applyTransition(game, { type } as GameEvent);
      expect(game.state, `${mode}: after ${type}`).toBe(expected);
    }
  }

  it('treats a game with no mode as a photo chase', () => {
    const legacy = makeGame({ config: { ...DEFAULT_CONFIG, mode: undefined as never } });
    expect(modeOf(legacy)).toBe('photo_chase');
  });

  it('runs the photo chase flow unchanged', () => {
    walk('photo_chase', [
      ['OPEN_LOBBY', 'lobby'],
      ['START_GAME', 'round1_active'],
      ['END_ROUND1', 'round1_return'],
      ['COMPLETE_RETURN1', 'round2_active'],
      ['END_ROUND2', 'round2_return'],
      ['COMPLETE_RETURN2', 'rating'],
      ['COMPLETE_RATING', 'finals_voting'],
      ['COMPLETE_FINALS', 'results'],
      ['ARCHIVE', 'archived'],
    ]);
  });

  it('sends a scavenger hunt from the return straight to rating', () => {
    walk('scavenger_hunt', [
      ['OPEN_LOBBY', 'lobby'],
      ['START_GAME', 'round1_active'],
      ['END_ROUND1', 'round1_return'],
      // No Round 2: the hunt is one round.
      ['COMPLETE_RETURN1', 'rating'],
      ['COMPLETE_RATING', 'finals_voting'],
      ['COMPLETE_FINALS', 'results'],
    ]);
  });

  it('runs colour hunt through its guessing window', () => {
    walk('color_hunt', [
      ['OPEN_LOBBY', 'lobby'],
      ['START_GAME', 'round1_active'],
      ['END_ROUND1', 'guessing'],
      ['CLOSE_GUESSING', 'rating'],
      ['COMPLETE_RATING', 'results'],
    ]);
  });

  it('runs photo tag through scatter and live play', () => {
    walk('photo_tag', [
      ['OPEN_LOBBY', 'lobby'],
      ['START_GAME', 'scatter'],
      ['END_SCATTER', 'tag_active'],
      ['END_TAG', 'finals_voting'],
      ['COMPLETE_FINALS', 'results'],
    ]);
  });

  it('rejects an event that belongs to another mode', () => {
    // Round 2 exists only in the chase; a scavenger hunt must not accept it.
    const hunt = inMode('scavenger_hunt', 'round1_return');
    const result = nextState(hunt, { type: 'END_ROUND2' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/not part of the scavenger_hunt flow/);
  });

  it('rejects a chase event that skips a phase', () => {
    const chase = inMode('photo_chase', 'round1_active');
    expect(nextState(chase, { type: 'COMPLETE_RETURN1' }).ok).toBe(false);
  });

  it('still enforces the minimum team count in every mode', () => {
    for (const mode of ['photo_chase', 'scavenger_hunt', 'color_hunt', 'photo_tag'] as GameMode[]) {
      const lonely = makeGame({ config: { ...DEFAULT_CONFIG, mode }, state: 'lobby', teams: [team('a')] });
      expect(nextState(lonely, { type: 'START_GAME' }).ok, mode).toBe(false);
    }
  });
});
