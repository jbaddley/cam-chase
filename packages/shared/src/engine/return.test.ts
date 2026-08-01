import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config/schema.js';
import type { Membership, Photo, Team } from '../domain/types.js';
import {
  DEFAULT_RETURN_RADIUS_M,
  MAX_ACCURACY_SLACK_M,
  allTeamsReady,
  isBackAtStart,
  metresToStart,
  resolveReturnFence,
  returnDurations,
  returnRoundOf,
  teamCheckins,
  teamReturnStatus,
  teamRoundProgress,
  teamsStillOut,
} from './return.js';
import { computeScoreboard } from './scoring.js';
import type { Game } from './state.js';

const START = { lat: 40, lng: -74 };

function team(id: string): Team {
  return { id, gameId: 'g1', name: id, createdAt: 0 };
}

function member(id: string, teamId: string | null, checkins: Membership['returnCheckins'] = {}): Membership {
  return { id, gameId: 'g1', userId: `u${id}`, teamId, role: 'captain', returnCheckins: checkins };
}

function photo(id: string, teamId: string): Photo {
  return {
    id, gameId: 'g1', teamId, shooterUserId: 'u', order: 0,
    location: START, capturedAt: 0, s3Key: `k/${id}.jpg`, fouls: [],
  };
}

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1', hostUserId: 'host', code: 'ABC123', tier: 'game_pack',
    config: { ...DEFAULT_CONFIG, photosPerRound: 2 },
    state: 'round1_active',
    teams: [team('A'), team('B')],
    memberships: [member('mA', 'A'), member('mB', 'B')],
    photos: [], assignments: [], votes: [], createdAt: 0,
    ...overrides,
  };
}

/** A geofenced game: the paid flag that turns a start point into a real fence. */
function fenced(overrides: Partial<Game> = {}): Game {
  const base = game(overrides);
  return { ...base, config: { ...base.config, geofencing: true } };
}

describe('returnRoundOf', () => {
  // The active phases count, not only the *_return ones. A team that has taken
  // its photos is done whether or not the host has called everyone in — that is
  // what lets one team be ready while another is still shooting.
  it('maps both the active and the return phase of each round', () => {
    expect(returnRoundOf('round1_active')).toBe('round1');
    expect(returnRoundOf('round1_return')).toBe('round1');
    expect(returnRoundOf('round2_active')).toBe('round2');
    expect(returnRoundOf('round2_return')).toBe('round2');
  });

  it('has no round outside them', () => {
    expect(returnRoundOf('lobby')).toBeNull();
    expect(returnRoundOf('rating')).toBeNull();
    expect(returnRoundOf('tag_active')).toBeNull();
  });
});

describe('resolveReturnFence', () => {
  it('prefers the host-configured spot, radius and all', () => {
    const g = fenced({
      config: { ...DEFAULT_CONFIG, returnSpot: { lat: 1, lng: 2, radiusM: 300 } },
      startSpot: { ...START, at: 0 },
    });
    // The host chose 300 m. It is not ours to widen or to override with a
    // point their phone happened to report.
    expect(resolveReturnFence(g)).toEqual({ center: { lat: 1, lng: 2 }, radiusM: 300 });
  });

  it('falls back to the point captured at Start, with the default radius', () => {
    const g = fenced({ startSpot: { ...START, at: 0 } });
    expect(resolveReturnFence(g)).toEqual({ center: START, radiusM: DEFAULT_RETURN_RADIUS_M });
  });

  it('uses the host-chosen radius around the Start point when set', () => {
    const g = fenced({ config: { ...DEFAULT_CONFIG, returnRadiusM: 150 }, startSpot: { ...START, at: 0 } });
    expect(resolveReturnFence(g)).toEqual({ center: START, radiusM: 150 });
  });

  it('has no fence when the host declined location', () => {
    expect(resolveReturnFence(game())).toBeNull();
  });

  it('has no fence when geofencing is off, even with a start point', () => {
    // Geofencing is the paid feature: a free game captures the point but never
    // fences against it — the return loop still runs, only enforcement is off.
    const g = game({ startSpot: { ...START, at: 0 } }); // geofencing defaults off
    expect(resolveReturnFence(g)).toBeNull();
    expect(isBackAtStart(g, { lat: -33, lng: 151 })).toBe(true); // accepted anywhere
    expect(metresToStart(g, { lat: 40.01, lng: -74 })).toBeNull();
  });
});

describe('isBackAtStart', () => {
  it('accepts anywhere when there is no fence', () => {
    // Exactly how every game behaved before a start point could be recorded.
    expect(isBackAtStart(game(), { lat: -33, lng: 151 })).toBe(true);
  });

  it('accepts inside the fence and refuses well outside it', () => {
    const g = fenced({ startSpot: { ...START, at: 0 } });
    expect(isBackAtStart(g, START)).toBe(true);
    expect(isBackAtStart(g, { lat: 40.01, lng: -74 })).toBe(false); // ~1.1 km
  });

  // A fix that says "within 60 m" should not be judged as though it were exact:
  // rejecting a team that is genuinely standing there strands them mid-game.
  it('widens the fence by the accuracy the device reported', () => {
    const g = fenced({ startSpot: { ...START, at: 0 } });
    const justOutside = { lat: 40.0009, lng: -74 }; // ~100 m, beyond the 75 m fence
    expect(isBackAtStart(g, justOutside)).toBe(false);
    expect(isBackAtStart(g, { ...justOutside, accuracyM: 60 })).toBe(true);
  });

  it('caps the slack so a hopeless fix cannot check in from anywhere', () => {
    const g = fenced({ startSpot: { ...START, at: 0 } });
    const farAway = { lat: 40.01, lng: -74, accuracyM: 50_000 };
    expect(MAX_ACCURACY_SLACK_M).toBeLessThan(1_000);
    expect(isBackAtStart(g, farAway)).toBe(false);
  });

  it('also forgives uncertainty in the host’s own fix', () => {
    const g = fenced({ startSpot: { ...START, accuracyM: 80, at: 0 } });
    expect(isBackAtStart(g, { lat: 40.0011, lng: -74 })).toBe(true); // ~122 m
  });
});

describe('metresToStart', () => {
  it('is null without a fence and zero inside one', () => {
    expect(metresToStart(game(), START)).toBeNull();
    expect(metresToStart(fenced({ startSpot: { ...START, at: 0 } }), START)).toBe(0);
  });

  it('rounds to 25 m, being wayfinding rather than a coordinate', () => {
    const g = fenced({ startSpot: { ...START, at: 0 } });
    const away = metresToStart(g, { lat: 40.004, lng: -74 })!; // ~444 m out
    expect(away % 25).toBe(0);
    expect(away).toBeGreaterThan(300);
  });
});

describe('teamCheckins and returnDurations', () => {
  it('takes a team’s earliest member check-in', () => {
    const g = game({
      memberships: [
        member('m1', 'A', { round1: 5_000 }),
        member('m2', 'A', { round1: 3_000 }),
        member('m3', 'B', { round1: 9_000 }),
      ],
    });
    expect(teamCheckins(g, 'round1')).toEqual({ A: 3_000, B: 9_000 });
  });

  it('ignores members with no team', () => {
    const g = game({ memberships: [member('mJ', null, { round1: 1_000 })] });
    expect(teamCheckins(g, 'round1')).toEqual({});
  });

  it('sums durations across rounds and omits teams that never returned', () => {
    const g = game({
      roundStartedAt: { round1: 1_000, round2: 10_000 },
      memberships: [
        member('mA', 'A', { round1: 2_000, round2: 12_000 }),
        member('mB', 'B', { round1: 4_000 }),
      ],
    });
    // B has no round-2 check-in, so only its round-1 leg counts; a team that
    // never returned at all is absent rather than scored as an instant return.
    expect(returnDurations(g)).toEqual({ A: 3_000, B: 3_000 });
  });

  it('feeds the scoring time bonus so the faster team ranks higher', () => {
    const g = game({
      roundStartedAt: { round1: 0 },
      memberships: [member('mA', 'A', { round1: 500 }), member('mB', 'B', { round1: 900 })],
    });
    const board = computeScoreboard({
      teamIds: ['A', 'B'],
      assignments: [],
      locations: {},
      votes: [],
      returnDurations: returnDurations(g),
    });
    expect(board.find((s) => s.teamId === 'A')!.timeBonus).toBe(40);
    expect(board.find((s) => s.teamId === 'B')!.timeBonus).toBe(30);
  });
});

describe('teamRoundProgress', () => {
  it('counts a team’s Round 1 photos against the quota', () => {
    const g = game({ photos: [photo('p1', 'A')] });
    expect(teamRoundProgress(g, 'A', 'round1')).toEqual({ done: 1, goal: 2 });
    expect(teamRoundProgress(g, 'B', 'round1')).toEqual({ done: 0, goal: 2 });
  });

  // Chase photos land in `game.photos` under the *chasing* team's id, so a naive
  // count keeps climbing after Round 2 starts and would report every team as
  // long since finished — including for the Round 1 gate.
  it('excludes Round 2 chases from the Round 1 count', () => {
    const g = game({
      state: 'round2_active',
      photos: [photo('p1', 'A'), photo('p2', 'A'), photo('c1', 'A')],
      assignments: [{ id: 'as1', gameId: 'g1', chaserTeamId: 'A', originalPhotoId: 'p9', order: 0, chasePhotoId: 'c1' }],
    });
    expect(teamRoundProgress(g, 'A', 'round1')).toEqual({ done: 2, goal: 2 });
  });

  it('counts Round 2 against the team’s own assignments', () => {
    const g = game({
      state: 'round2_active',
      assignments: [
        { id: 'as1', gameId: 'g1', chaserTeamId: 'A', originalPhotoId: 'p1', order: 0, chasePhotoId: 'c1' },
        { id: 'as2', gameId: 'g1', chaserTeamId: 'A', originalPhotoId: 'p2', order: 1, chasePhotoId: null },
        { id: 'as3', gameId: 'g1', chaserTeamId: 'B', originalPhotoId: 'p3', order: 0, chasePhotoId: null },
      ],
    });
    expect(teamRoundProgress(g, 'A', 'round2')).toEqual({ done: 1, goal: 2 });
    expect(teamRoundProgress(g, 'B', 'round2')).toEqual({ done: 0, goal: 1 });
  });

  it('uses the hunt list as the quota in a scavenger hunt', () => {
    const g = game({
      config: { ...DEFAULT_CONFIG, mode: 'scavenger_hunt', photosPerRound: 2 },
      hunt: { items: [{ id: 'i1', label: 'a', rarity: 'common' }, { id: 'i2', label: 'b', rarity: 'common' }, { id: 'i3', label: 'c', rarity: 'rare' }] },
    });
    expect(teamRoundProgress(g, 'A', 'round1').goal).toBe(3);
  });
});

describe('teamReturnStatus', () => {
  it('is shooting, then heading back, then ready', () => {
    const shooting = game({ photos: [photo('p1', 'A')] });
    expect(teamReturnStatus(shooting, 'A', 'round1')).toBe('shooting');

    const done = game({ photos: [photo('p1', 'A'), photo('p2', 'A')] });
    expect(teamReturnStatus(done, 'A', 'round1')).toBe('heading_back');

    const back = game({
      photos: [photo('p1', 'A'), photo('p2', 'A')],
      memberships: [member('mA', 'A', { round1: 1 }), member('mB', 'B')],
    });
    expect(teamReturnStatus(back, 'A', 'round1')).toBe('ready');
  });

  // Being back beats having work left: a team called in early with photos still
  // owed has checked in, and the roster should say so rather than "shooting".
  it('reports ready even with work outstanding', () => {
    const g = game({ memberships: [member('mA', 'A', { round1: 1 }), member('mB', 'B')] });
    expect(teamRoundProgress(g, 'A', 'round1').done).toBe(0);
    expect(teamReturnStatus(g, 'A', 'round1')).toBe('ready');
  });
});

describe('allTeamsReady', () => {
  it('is true only once every team has checked in', () => {
    const one = game({ memberships: [member('mA', 'A', { round1: 1 }), member('mB', 'B')] });
    expect(allTeamsReady(one, 'round1')).toBe(false);
    expect(teamsStillOut(one, 'round1')).toBe(1);

    const both = game({
      memberships: [member('mA', 'A', { round1: 1 }), member('mB', 'B', { round1: 2 })],
    });
    expect(allTeamsReady(both, 'round1')).toBe(true);
    expect(teamsStillOut(both, 'round1')).toBe(0);
  });

  // Without this an empty game is vacuously ready, and the gate built on it
  // would wave through exactly the state it exists to catch.
  it('is false for a game with no teams', () => {
    expect(allTeamsReady(game({ teams: [] }), 'round1')).toBe(false);
  });

  it('tracks each round separately', () => {
    const g = game({
      memberships: [member('mA', 'A', { round1: 1 }), member('mB', 'B', { round1: 2 })],
    });
    expect(allTeamsReady(g, 'round1')).toBe(true);
    expect(allTeamsReady(g, 'round2')).toBe(false);
  });
});
