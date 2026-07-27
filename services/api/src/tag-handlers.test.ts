import {
  CATCH_POINTS,
  DEFAULT_CONFIG,
  SURVIVAL_POINTS,
  PROXIMITY_WARNING_M,
  type Game,
  type GameConfig,
} from '@photochase/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  advanceGame,
  answerCatchClaim,
  claimCatch,
  createGame,
  getResults,
  getTagBrief,
  joinByCode,
  listCatchClaims,
  reportTagPing,
  resolveCatchDispute,
  startGame,
  submitPhoto,
} from './handlers.js';
import { InMemoryGameRepository } from './repository.js';

/**
 * Handler-level coverage for Photo Tag.
 *
 * Two things carry most of the weight here and both are privacy constraints
 * rather than game rules: nobody is ever told who hunts them, and a catch is
 * only ever settled by a person, never by the machine (docs/07).
 *
 * **What these tests cannot cover:** proximity thresholds, scatter timing and
 * catch latency depend on real GPS on real devices. The logic is verified; the
 * feel is not, and cannot be until this runs on hardware.
 */

let repo: InMemoryGameRepository;
beforeEach(() => {
  repo = new InMemoryGameRepository();
});

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.data;
}

const TAG_CONFIG: GameConfig = { ...DEFAULT_CONFIG, mode: 'photo_tag', tagSubMode: 'dual', maxTeams: 3 };
const SPOT = { lat: 40, lng: -74 };
/** Roughly 20 m from SPOT — inside the warning threshold. */
const NEARBY = { lat: 40.00018, lng: -74 };
/** Roughly 500 m from SPOT — well outside it. */
const FAR = { lat: 40.0045, lng: -74 };

/** A tag game in `scatter` with three players, each their own team of one. */
async function scattered(config: Partial<GameConfig> = {}) {
  const { gameId, code } = await unwrap(
    createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: { ...TAG_CONFIG, ...config } }),
  );
  const players = [];
  for (const name of ['A', 'B', 'C']) {
    const joined = await unwrap(
      joinByCode(repo, {
        code,
        userId: `u${name}`,
        displayName: name,
        action: { type: 'create_team', name },
        acceptsBeingPhotographed: true,
      }),
    );
    players.push({ userId: `u${name}`, teamId: joined.teamId! });
  }
  await unwrap(startGame(repo, { gameId, hostUserId: 'host' }));
  return { gameId, players };
}

/** A tag game with live play running. */
async function running(config: Partial<GameConfig> = {}) {
  const game = await scattered(config);
  await unwrap(advanceGame(repo, { gameId: game.gameId, hostUserId: 'host', event: 'END_SCATTER' }));
  return game;
}

/** Shoot a photo as `userId`, which is what a catch claim is attached to. */
async function shoot(gameId: string, player: { userId: string; teamId: string }) {
  const { photoId } = await unwrap(
    submitPhoto(repo, { gameId, teamId: player.teamId, shooterUserId: player.userId, location: SPOT, s3Key: `${player.userId}-1` }),
  );
  return photoId;
}

describe('joining a tag game', () => {
  it('refuses a player who has not agreed to being photographed', async () => {
    // Enforced server-side rather than shown on a screen you can scroll past.
    const { code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: TAG_CONFIG }));
    const result = await joinByCode(repo, {
      code,
      userId: 'uA',
      displayName: 'A',
      action: { type: 'create_team', name: 'A' },
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/photographed/);
  });

  it('lets a judge in without the acknowledgement, since they neither shoot nor are shot', async () => {
    const { code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: TAG_CONFIG }));
    expect((await joinByCode(repo, { code, userId: 'j', displayName: 'J', action: { type: 'judge' } })).ok).toBe(true);
  });

  it('asks for no such acknowledgement in a mode that photographs places', async () => {
    const { code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: DEFAULT_CONFIG }));
    expect(
      (await joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } })).ok,
    ).toBe(true);
  });
});

describe('getTagBrief', () => {
  it('withholds role and target through the scatter window', async () => {
    // Nobody knows who they are yet — that is what `scatter` is for.
    const { gameId, players } = await scattered();
    const brief = await unwrap(getTagBrief(repo, { gameId, userId: players[0]!.userId }));
    expect(brief.role).toBeNull();
    expect(brief.targetTeamId).toBeNull();
  });

  it('names your prey once the round starts', async () => {
    const { gameId, players } = await running();
    const brief = await unwrap(getTagBrief(repo, { gameId, userId: players[0]!.userId }));
    expect(brief.targetTeamId).toBeTruthy();
    expect(brief.targetTeamId).not.toBe(players[0]!.teamId);
    expect(brief.targetTeamName).toBeTruthy();
  });

  it('never names the player hunting you', async () => {
    // Naming the hunter lets the prey simply avoid one person — the exploit
    // this mode is designed around (docs/07).
    const { gameId, players } = await running();
    const brief = await unwrap(getTagBrief(repo, { gameId, userId: players[0]!.userId }));
    const game = (await repo.get(gameId)) as Game;
    const hunter = Object.entries(game.tag!.targets!).find(([, prey]) => prey === players[0]!.teamId)![0];

    expect(JSON.stringify(brief)).not.toContain(hunter);
    expect(Object.keys(brief)).not.toContain('hunterTeamId');
  });

  it('gives a hide-and-seek player their own role and nobody else’s', async () => {
    const { gameId, players } = await running({ tagSubMode: 'hide_seek' });
    const game = (await repo.get(gameId)) as Game;
    for (const player of players) {
      const brief = await unwrap(getTagBrief(repo, { gameId, userId: player.userId }));
      expect(brief.role).toBe(game.tag!.roles![player.teamId]);
      // Another player's role must not be reachable from this payload.
      const others = players.filter((p) => p.teamId !== player.teamId).map((p) => p.teamId);
      for (const other of others) expect(JSON.stringify(brief)).not.toContain(other);
    }
  });

  it('refuses a judge, who is on no team and so has no brief', async () => {
    const { gameId, code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: TAG_CONFIG }));
    await unwrap(joinByCode(repo, { code, userId: 'judge', displayName: 'J', action: { type: 'judge' } }));
    expect((await getTagBrief(repo, { gameId, userId: 'judge' })).ok).toBe(false);
  });

  it('refuses someone outside the game', async () => {
    const { gameId } = await running();
    expect((await getTagBrief(repo, { gameId, userId: 'stranger' })).ok).toBe(false);
  });

  it('refuses a game that is not a tag game', async () => {
    const { gameId, code } = await unwrap(createGame(repo, { hostUserId: 'host', tier: 'unlimited', config: DEFAULT_CONFIG }));
    await unwrap(joinByCode(repo, { code, userId: 'uA', displayName: 'A', action: { type: 'create_team', name: 'A' } }));
    expect((await getTagBrief(repo, { gameId, userId: 'uA' })).ok).toBe(false);
  });
});

describe('proximity warning', () => {
  it('warns when your hunter is close', async () => {
    const { gameId, players } = await running();
    const game = (await repo.get(gameId)) as Game;
    const prey = players[0]!;
    const hunterTeam = Object.entries(game.tag!.targets!).find(([, t]) => t === prey.teamId)![0];
    const hunter = players.find((p) => p.teamId === hunterTeam)!;

    await unwrap(reportTagPing(repo, { gameId, userId: prey.userId, location: SPOT }));
    await unwrap(reportTagPing(repo, { gameId, userId: hunter.userId, location: NEARBY }));

    expect((await unwrap(getTagBrief(repo, { gameId, userId: prey.userId }))).hunterNearby).toBe(true);
  });

  it('stays quiet when the hunter is well away', async () => {
    const { gameId, players } = await running();
    const game = (await repo.get(gameId)) as Game;
    const prey = players[0]!;
    const hunterTeam = Object.entries(game.tag!.targets!).find(([, t]) => t === prey.teamId)![0];
    const hunter = players.find((p) => p.teamId === hunterTeam)!;

    await unwrap(reportTagPing(repo, { gameId, userId: prey.userId, location: SPOT }));
    await unwrap(reportTagPing(repo, { gameId, userId: hunter.userId, location: FAR }));

    expect((await unwrap(getTagBrief(repo, { gameId, userId: prey.userId }))).hunterNearby).toBe(false);
    expect(PROXIMITY_WARNING_M).toBeLessThan(500);
  });

  it('never returns anyone else’s position', async () => {
    const { gameId, players } = await running();
    await unwrap(reportTagPing(repo, { gameId, userId: players[1]!.userId, location: NEARBY }));

    const brief = await unwrap(getTagBrief(repo, { gameId, userId: players[0]!.userId }));
    expect(JSON.stringify(brief)).not.toContain(String(NEARBY.lat));
  });

  it('refuses a ping before the round is running', async () => {
    const { gameId, players } = await scattered();
    expect((await reportTagPing(repo, { gameId, userId: players[0]!.userId, location: SPOT })).ok).toBe(false);
  });
});

describe('catch claims', () => {
  it('records a claim as pending, scoring nothing yet', async () => {
    const { gameId, players } = await running();
    const photoId = await shoot(gameId, players[0]!);
    const claimed = await unwrap(
      claimCatch(repo, { gameId, hunterUserId: players[0]!.userId, targetTeamId: players[1]!.teamId, photoId }),
    );
    expect(claimed.status).toBe('pending');
  });

  it('shows the claim to the target, with the photo to judge', async () => {
    // The peer check *is* the verification: nothing here can answer "is this
    // person X" without face recognition, which doc 07 forbids.
    const { gameId, players } = await running();
    const photoId = await shoot(gameId, players[0]!);
    await unwrap(claimCatch(repo, { gameId, hunterUserId: players[0]!.userId, targetTeamId: players[1]!.teamId, photoId }));

    const claims = await unwrap(listCatchClaims(repo, { gameId, userId: players[1]!.userId }));
    expect(claims).toHaveLength(1);
    expect(claims[0]!.photoKey).toBe('uA-1');
    expect(claims[0]!.status).toBe('pending');
  });

  it('shows a player nothing claimed against someone else', async () => {
    const { gameId, players } = await running();
    const photoId = await shoot(gameId, players[0]!);
    await unwrap(claimCatch(repo, { gameId, hunterUserId: players[0]!.userId, targetTeamId: players[1]!.teamId, photoId }));

    expect(await unwrap(listCatchClaims(repo, { gameId, userId: players[2]!.userId }))).toHaveLength(0);
  });

  it('refuses a claim against yourself', async () => {
    const { gameId, players } = await running();
    const photoId = await shoot(gameId, players[0]!);
    expect(
      (await claimCatch(repo, { gameId, hunterUserId: players[0]!.userId, targetTeamId: players[0]!.teamId, photoId })).ok,
    ).toBe(false);
  });

  it('refuses a claim on somebody else’s photo', async () => {
    const { gameId, players } = await running();
    const photoId = await shoot(gameId, players[1]!);
    expect(
      (await claimCatch(repo, { gameId, hunterUserId: players[0]!.userId, targetTeamId: players[1]!.teamId, photoId })).ok,
    ).toBe(false);
  });

  it('refuses a claim outside the running round', async () => {
    const { gameId, players } = await running();
    const photoId = await shoot(gameId, players[0]!);
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_TAG' }));
    expect(
      (await claimCatch(repo, { gameId, hunterUserId: players[0]!.userId, targetTeamId: players[1]!.teamId, photoId })).ok,
    ).toBe(false);
  });
});

describe('answering and ruling', () => {
  /** A pending claim by player 0 against player 1 (0's assigned prey in dual). */
  async function claimed(config: Partial<GameConfig> = {}) {
    const game = await running(config);
    const gameState = (await repo.get(game.gameId)) as Game;
    const hunter = game.players[0]!;
    const preyTeam = gameState.tag!.targets![hunter.teamId]!;
    const prey = game.players.find((p) => p.teamId === preyTeam)!;
    const photoId = await shoot(game.gameId, hunter);
    const { catchId } = await unwrap(
      claimCatch(repo, { gameId: game.gameId, hunterUserId: hunter.userId, targetTeamId: prey.teamId, photoId }),
    );
    return { ...game, hunter, prey, catchId };
  }

  const scoreFor = async (gameId: string, teamId: string) => {
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'END_TAG' }));
    await unwrap(advanceGame(repo, { gameId, hostUserId: 'host', event: 'COMPLETE_FINALS' }));
    const board = await unwrap(getResults(repo, gameId));
    return board.scoreboard.find((s) => s.teamId === teamId)!;
  };

  it('scores the catch once the target confirms it', async () => {
    const { gameId, hunter, prey, catchId } = await claimed();
    await unwrap(answerCatchClaim(repo, { gameId, userId: prey.userId, catchId, confirm: true }));
    expect((await scoreFor(gameId, hunter.teamId)).location).toBe(CATCH_POINTS);
  });

  it('scores nothing while the claim sits unanswered', async () => {
    const { gameId, hunter } = await claimed();
    expect((await scoreFor(gameId, hunter.teamId)).location).toBe(0);
  });

  it('scores nothing on a dispute, pending the host', async () => {
    const { gameId, hunter, prey, catchId } = await claimed();
    await unwrap(answerCatchClaim(repo, { gameId, userId: prey.userId, catchId, confirm: false }));
    expect((await scoreFor(gameId, hunter.teamId)).location).toBe(0);
  });

  it('lets only the target answer', async () => {
    const { gameId, hunter, catchId } = await claimed();
    expect((await answerCatchClaim(repo, { gameId, userId: hunter.userId, catchId, confirm: true })).ok).toBe(false);
  });

  it('lets the host uphold a disputed claim', async () => {
    const { gameId, hunter, prey, catchId } = await claimed();
    await unwrap(answerCatchClaim(repo, { gameId, userId: prey.userId, catchId, confirm: false }));
    await unwrap(resolveCatchDispute(repo, { gameId, hostUserId: 'host', catchId, uphold: true }));
    expect((await scoreFor(gameId, hunter.teamId)).location).toBe(CATCH_POINTS);
  });

  it('lets the host overrule it, and that ruling is final', async () => {
    const { gameId, hunter, prey, catchId } = await claimed();
    await unwrap(answerCatchClaim(repo, { gameId, userId: prey.userId, catchId, confirm: false }));
    await unwrap(resolveCatchDispute(repo, { gameId, hostUserId: 'host', catchId, uphold: false }));

    // A player must not be able to answer their way out of a host decision.
    expect((await answerCatchClaim(repo, { gameId, userId: prey.userId, catchId, confirm: true })).ok).toBe(false);
    expect((await scoreFor(gameId, hunter.teamId)).location).toBe(0);
  });

  it('refuses a ruling from anyone but the host', async () => {
    const { gameId, prey, catchId } = await claimed();
    await unwrap(answerCatchClaim(repo, { gameId, userId: prey.userId, catchId, confirm: false }));
    expect((await resolveCatchDispute(repo, { gameId, hostUserId: prey.userId, catchId, uphold: true })).ok).toBe(false);
  });

  it('refuses a ruling on a claim nobody disputed', async () => {
    const { gameId, catchId } = await claimed();
    expect((await resolveCatchDispute(repo, { gameId, hostUserId: 'host', catchId, uphold: true })).ok).toBe(false);
  });

  it('pays survival to a player nobody confirmably caught', async () => {
    const { gameId, prey } = await claimed();
    expect((await scoreFor(gameId, prey.teamId)).pose).toBe(SURVIVAL_POINTS);
  });
});
