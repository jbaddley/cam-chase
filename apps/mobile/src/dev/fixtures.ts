import type { FetchFn } from '@photochase/client';

/**
 * A fake API for driving the real screens on a real device.
 *
 * The screens' logic is covered under jsdom, but that harness drops styles and
 * cannot see layout — so the bugs it misses are the visible ones: a background
 * that hides the camera, a panel that covers the frame, a tap the overlay
 * swallows, a translated string that wraps badly. Those need real pixels, and
 * real pixels used to need a signed-in session and a live game in exactly the
 * right phase, which is why they mostly went unchecked.
 *
 * This removes the session and the server from that loop. `ClientConfig.fetch`
 * has been injectable from the start — "so the client is fully unit-testable" —
 * and this is the same seam used one layer out, so no screen and no client
 * method changes. Every state is reachable instantly, including the ones that
 * are tedious to reach for real: five teams with one still out, a check-in
 * refused from 900 km away, an assignment queue half finished.
 *
 * Never present in a production build: {@link installFixtures} is the only
 * export that touches it and it is guarded twice — see `api.ts`.
 */

/** Which scripted situation the app is in. Switched by the dev banner. */
export type FixtureScene =
  | 'lobby'
  | 'round1_shooting'
  | 'round1_heading_back'
  | 'round1_all_back'
  | 'round1_far_away'
  | 'round2_chasing'
  | 'rating'
  | 'finals'
  | 'results';

/** Scenes that put you inside a game, as opposed to the app's other routes. */
export const IN_GAME: FixtureScene[] = [
  'lobby',
  'round1_shooting',
  'round1_heading_back',
  'round1_all_back',
  'round1_far_away',
  'round2_chasing',
  'rating',
  'finals',
  'results',
];

let scene: FixtureScene = 'round1_shooting';

export function setScene(next: FixtureScene): void {
  scene = next;
}

export function currentScene(): FixtureScene {
  return scene;
}

export const SCENES: FixtureScene[] = [...IN_GAME];

const GAME_ID = 'game_dev';
const TEAM = 'team_dev';

/** The phase each scene puts the game in. */
function stateFor(s: FixtureScene): string {
  if (s === 'lobby') return 'lobby';
  if (s === 'round2_chasing') return 'round2_active';
  if (s === 'rating') return 'rating';
  if (s === 'finals') return 'finals_voting';
  if (s === 'results') return 'results';
  return 'round1_active';
}

function gameState() {
  return {
    id: GAME_ID,
    code: 'DEV123',
    state: stateFor(scene),
    config: {
      mode: 'photo_chase',
      photosPerRound: 5,
      round1Minutes: 10,
      round2Minutes: 10,
      maxTeams: 3,
      gameType: 'round_robin',
      judgeWeight: 1,
      specialCategories: { presets: [], custom: [] },
      geofencing: false,
      aiJudging: false,
    },
    teams: [
      { teamId: TEAM, name: 'Ugly Ducklings', memberCount: 2 },
      { teamId: 'team_b', name: 'Baby Sharks', memberCount: 3 },
      { teamId: 'team_c', name: 'Wandering Albatross', memberCount: 1 },
    ],
    playerCount: 6,
    hostTier: 'game_pack',
  };
}

function regroup() {
  // `round2_chasing` has to read as still-working, or the router sends it to the
  // regroup screen — which is correct behaviour and made the scene show the wrong
  // screen entirely. The harness found its own bug first.
  const meStatus =
    scene === 'round1_shooting' || scene === 'round2_chasing'
      ? 'shooting'
      : scene === 'round1_all_back'
        ? 'ready'
        : 'heading_back';
  const allBack = scene === 'round1_all_back';
  return {
    round: scene === 'round2_chasing' ? 2 : 1,
    calledBack: false,
    fenced: true,
    roundStartedAt: Date.now() - 4 * 60_000,
    roundEndsAt: Date.now() + 6 * 60_000,
    teams: [
      { teamId: TEAM, name: 'Ugly Ducklings', status: meStatus },
      { teamId: 'team_b', name: 'Baby Sharks', status: allBack ? 'ready' : 'shooting' },
      { teamId: 'team_c', name: 'Wandering Albatross', status: allBack ? 'ready' : 'heading_back' },
    ],
    readyCount: allBack ? 3 : meStatus === 'ready' ? 1 : 0,
    teamCount: 3,
    allReady: allBack,
    me: { teamId: TEAM, status: meStatus, done: meStatus === 'shooting' ? 2 : 5, goal: 5 },
  };
}

/**
 * A real JPEG the size of a photo, so the chase overlay has something with
 * actual dimensions to composite. A 2×2 red pixel scaled by `Image` — enough to
 * prove the geometry without bundling a fixture asset.
 */
const FIXTURE_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzNP/AABEIAAIAAgMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A9mooooA//9k=';

/** Route → canned body. Unknown routes fail loudly rather than silently. */
function respond(method: string, path: string, body: unknown): unknown {
  // Identity lives with the login now; the harness ships a completed profile so
  // it lands on home rather than the "complete your profile" form. A save echoes
  // what was sent, so editing the display name reads back as it would for real.
  if (method === 'GET' && /\/me\/profile$/.test(path)) {
    return { firstName: 'Dev', lastName: 'Tester', displayName: 'Ducky' };
  }
  if (method === 'PUT' && /\/me\/profile$/.test(path)) {
    return body ?? { firstName: 'Dev', lastName: 'Tester', displayName: 'Ducky' };
  }
  if (method === 'GET' && /\/games\/[^/]+\/regroup$/.test(path)) return regroup();
  // The public peek the join flow uses to resolve a code (typed or scanned).
  if (method === 'GET' && /\/spectate\/[^/]+$/.test(path)) return { game: gameState(), scoreboard: null };
  if (method === 'GET' && /\/games\/[^/]+$/.test(path)) return gameState();
  if (method === 'GET' && /\/games\/[^/]+\/teams$/.test(path)) return gameState().teams;
  if (method === 'GET' && /\/games\/[^/]+\/assignments$/.test(path)) {
    return [
      { assignmentId: 'a0', order: 0, originalPhotoId: 'p0', originalPhotoKey: 'k0', chasePhotoId: null },
      { assignmentId: 'a1', order: 1, originalPhotoId: 'p1', originalPhotoKey: 'k1', chasePhotoId: null },
      { assignmentId: 'a2', order: 2, originalPhotoId: 'p2', originalPhotoKey: 'k2', chasePhotoId: 'c2' },
    ];
  }
  if (method === 'GET' && /\/games\/[^/]+\/rateable$/.test(path)) {
    return [
      {
        assignmentId: 'a0',
        originalPhotoId: 'p0',
        originalPhotoKey: 'k0',
        chasePhotoId: 'c0',
        chasePhotoKey: 'ck0',
        myVotes: { pose: null, angle: null, validity: null },
        originalFouls: [],
      },
      {
        assignmentId: 'a1',
        originalPhotoId: 'p1',
        originalPhotoKey: 'k1',
        chasePhotoId: 'c1',
        chasePhotoKey: 'ck1',
        myVotes: { pose: 4, angle: 3, validity: null },
        originalFouls: ['no_face'],
      },
    ];
  }
  if (method === 'GET' && /\/games\/[^/]+\/finals$/.test(path)) {
    return {
      categories: [
        { id: 'best_overall_match', label: 'Best overall match' },
        { id: 'Craziest Pose', label: 'Craziest Pose' },
      ],
      teams: gameState().teams.map((t) => ({ teamId: t.teamId, name: t.name })),
      myVotes: {},
    };
  }
  if (method === 'GET' && /\/games\/[^/]+\/results$/.test(path)) {
    return {
      scoreboard: [
        { teamId: TEAM, location: 420, pose: 88, angle: 72, timeBonus: 40, fouls: 0, finals: 25, total: 645 },
        { teamId: 'team_b', location: 380, pose: 74, angle: 66, timeBonus: 30, fouls: -20, finals: 0, total: 530 },
        { teamId: 'team_c', location: 210, pose: 51, angle: 44, timeBonus: 20, fouls: 0, finals: 0, total: 325 },
      ],
    };
  }
  if (method === 'POST' && /\/votes$/.test(path)) return { voteId: 'v1' };
  if (method === 'POST' && /\/downloads$/.test(path)) return { url: FIXTURE_JPEG };
  if (method === 'POST' && /\/checkins$/.test(path)) {
    // The scene the whole distance-formatting fix was written for.
    if (scene === 'round1_far_away') {
      throw new FixtureError(
        400,
        'You are 942 km from the start point — the host needs to reset the meeting spot.',
      );
    }
    return { round: 'round1', at: Date.now() };
  }
  if (method === 'POST' && /\/start-spot$/.test(path)) return { fenced: false };
  if (method === 'POST' && /\/advance$/.test(path)) return { state: 'round2_active' };
  if (method === 'POST' && /\/start$/.test(path)) return { state: 'round1_active' };
  if (method === 'GET' && /\/entitlement$/.test(path)) {
    return {
      tier: 'game_pack',
      gameCredits: 3,
      subscriptionActive: false,
      canStartGame: true,
      limits: { maxTeams: 3, configurableRounds: true, allowedGameTypes: ['round_robin'], maxJudgeWeight: 3, allowGeofencing: true },
      modes: ['photo_chase', 'scavenger_hunt'],
      features: {},
    };
  }
  throw new FixtureError(404, `No fixture for ${method} ${path}`);
}

class FixtureError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A `fetch` that answers from {@link respond}.
 *
 * Latency is deliberate and small: zero-latency responses resolve before the
 * first paint, which hides every loading state and makes them the one thing this
 * harness cannot show you.
 */
export function fixtureFetch(): FetchFn {
  return async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = input.replace(/^https?:\/\/[^/]+/, '');
    const sent = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    await new Promise((r) => setTimeout(r, 120));
    try {
      const body = respond(method, path, sent);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } catch (e) {
      const err = e as FixtureError;
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status ?? 500,
        headers: { 'content-type': 'application/json' },
      });
    }
  };
}
