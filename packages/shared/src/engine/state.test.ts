import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config/schema.js';
import type { Membership, Team } from '../domain/types.js';
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

/**
 * A membership per team with both rounds already checked in.
 *
 * Completing a return now requires every team to be back, so a game walked
 * forward through the whole lifecycle has to look like one where they were —
 * rather than passing `force` everywhere, which would stop the walk exercising
 * the gate at all.
 */
function allBack(teams: Team[]): Membership[] {
  return teams.map((t) => ({
    id: `m${t.id}`,
    gameId: 'g1',
    userId: `u${t.id}`,
    teamId: t.id,
    role: 'captain' as const,
    returnCheckins: { round1: 1_000, round2: 2_000 },
  }));
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
    const teams = [team('a'), team('b')];
    let game = makeGame({ teams, memberships: allBack(teams) });
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

  it('rejects an event whose source state is genuinely unreachable', () => {
    // COMPLETE_RETURN2 is legal from round2_active now, so it is no longer a
    // skip; ending Round 2 from Round 1 still is.
    const game = makeGame({ state: 'round1_active' });
    const result = nextState(game, { type: 'END_ROUND2' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/requires "round2_active"/);
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

describe('nextState — the return gate', () => {
  const teams = [team('a'), team('b')];
  /** Only team `a` is back; `b` is still out there. */
  const partly = () =>
    makeGame({
      state: 'round1_return',
      teams,
      memberships: [
        { id: 'ma', gameId: 'g1', userId: 'ua', teamId: 'a', role: 'captain', returnCheckins: { round1: 1 } },
        { id: 'mb', gameId: 'g1', userId: 'ub', teamId: 'b', role: 'captain', returnCheckins: {} },
      ],
    });

  it('refuses to start Round 2 while a team is still out', () => {
    const result = nextState(partly(), { type: 'COMPLETE_RETURN1' });
    expect(result.ok).toBe(false);
    // Says how many, because "someone is missing" is not actionable when the
    // host is standing in a car park counting heads.
    if (!result.ok) expect(result.error).toMatch(/1 team has not checked in/);
  });

  it('starts Round 2 once every team is back', () => {
    const g = makeGame({ state: 'round1_return', teams, memberships: allBack(teams) });
    expect(nextState(g, { type: 'COMPLETE_RETURN1' })).toEqual({ ok: true, state: 'round2_active' });
  });

  // A phone dies, or someone gives up and goes home. A game that cannot be
  // advanced past a missing team is a dead game, so the host can override —
  // and it costs that team its time bonus, which is why it is explicit.
  it('lets a forcing host through with a team missing', () => {
    expect(nextState(partly(), { type: 'COMPLETE_RETURN1', force: true })).toEqual({
      ok: true,
      state: 'round2_active',
    });
  });

  it('does not treat any other truthy force as a force', () => {
    // The route coerces this, but the engine should not be the only thing
    // standing between a stray string and a forced game.
    const sneaky = { type: 'COMPLETE_RETURN1', force: 'yes' } as unknown as GameEvent;
    expect(nextState(partly(), sneaky).ok).toBe(false);
  });

  // The whole point of widening the source states: if every team finished and
  // checked in while the round was still running, the host presses once.
  it('completes the return straight from an active round', () => {
    const g = makeGame({ state: 'round1_active', teams, memberships: allBack(teams) });
    expect(nextState(g, { type: 'COMPLETE_RETURN1' })).toEqual({ ok: true, state: 'round2_active' });
  });

  it('guards the Round 2 return the same way', () => {
    const out = makeGame({
      state: 'round2_return',
      teams,
      memberships: [
        { id: 'ma', gameId: 'g1', userId: 'ua', teamId: 'a', role: 'captain', returnCheckins: { round1: 1, round2: 2 } },
        { id: 'mb', gameId: 'g1', userId: 'ub', teamId: 'b', role: 'captain', returnCheckins: { round1: 1 } },
      ],
    });
    expect(nextState(out, { type: 'COMPLETE_RETURN2' }).ok).toBe(false);
    expect(nextState(out, { type: 'COMPLETE_RETURN2', force: true }).ok).toBe(true);
  });

  it('refuses a game with no teams rather than waving it through', () => {
    // Nobody is missing only because nobody is playing.
    const empty = makeGame({ state: 'round1_return', teams: [], memberships: [] });
    expect(nextState(empty, { type: 'COMPLETE_RETURN1' }).ok).toBe(false);
  });

  it('guards a scavenger hunt’s single return too', () => {
    const g = makeGame({
      config: { ...DEFAULT_CONFIG, mode: 'scavenger_hunt' },
      state: 'round1_return',
      teams,
      memberships: partly().memberships,
    });
    expect(nextState(g, { type: 'COMPLETE_RETURN1' }).ok).toBe(false);
  });
});

describe('mode-scoped flows', () => {
  /** A game in the given mode and state, with enough teams to start. */
  function inMode(mode: GameMode, state: Game['state']): Game {
    const teams = [team('a'), team('b')];
    return makeGame({
      config: { ...DEFAULT_CONFIG, mode },
      state,
      teams,
      memberships: allBack(teams),
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
    // Completing the Round 1 return from round1_active is now deliberate, not a
    // skip — so this asserts a transition that really has no path: rating
    // cannot be reached from Round 1 without going through Round 2.
    const chase = inMode('photo_chase', 'round1_active');
    const result = nextState(chase, { type: 'COMPLETE_RETURN2' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/requires/);
  });

  it('still enforces the minimum team count in every mode', () => {
    for (const mode of ['photo_chase', 'scavenger_hunt', 'color_hunt', 'photo_tag'] as GameMode[]) {
      const lonely = makeGame({ config: { ...DEFAULT_CONFIG, mode }, state: 'lobby', teams: [team('a')] });
      expect(nextState(lonely, { type: 'START_GAME' }).ok, mode).toBe(false);
    }
  });

  describe('abandoning', () => {
    const at = (state: Game['state'], mode: GameMode = 'photo_chase') =>
      makeGame({ state, config: { ...DEFAULT_CONFIG, mode } });

    it.each(['lobby', 'round1_active', 'round1_return', 'rating', 'finals_voting'] as const)(
      'is allowed from %s',
      (state) => {
        expect(nextState(at(state), { type: 'ABANDON' })).toEqual({ ok: true, state: 'archived' });
      },
    );

    it.each(['scavenger_hunt', 'color_hunt', 'photo_tag'] as const)(
      'is allowed in %s too, since it belongs to no mode',
      (mode) => {
        expect(nextState(at('lobby', mode), { type: 'ABANDON' })).toEqual({ ok: true, state: 'archived' });
      },
    );

    it('refuses a game that already reached results', () => {
      // People are still reading the scoreboard; ending it again would take it
      // away from them.
      expect(nextState(at('results'), { type: 'ABANDON' }).ok).toBe(false);
    });

    it('refuses a game that is already archived', () => {
      expect(nextState(at('archived'), { type: 'ABANDON' }).ok).toBe(false);
    });

    it('does not need the minimum team count', () => {
      // Leaving is exactly what you do when nobody else turned up.
      const empty = makeGame({ state: 'lobby', teams: [] });
      expect(nextState(empty, { type: 'ABANDON' }).ok).toBe(true);
    });
  });
});
