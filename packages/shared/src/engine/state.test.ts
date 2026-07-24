import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config/schema.js';
import type { Team } from '../domain/types.js';
import { applyTransition, nextState, type Game, type GameEvent } from './state.js';

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
