import {
  DAILY_ITEM_COUNT,
  DEFAULT_CONFIG,
  dailyHuntList,
  dailyKey,
  dailyTheme,
  type Game,
  type HuntItem,
} from '@photochase/shared';
import { createGame, joinByCode, startGame, type Result } from './handlers.js';
import type { GameRepository } from './repository.js';
import type { DailyHuntRepository } from './tournament-repo.js';

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const err = (error: string): Result<never> => ({ ok: false, error });

/** Today's solo run: the game to play it in, and the list it is played against. */
export interface DailyHuntView {
  gameId: string;
  /** UTC date this run belongs to. */
  dateKey: string;
  theme: string;
  items: HuntItem[];
  /** True when this call resumed a run already in progress. */
  resumed: boolean;
}

/**
 * Start (or resume) today's solo daily hunt.
 *
 * **Deliberately free on every plan**, unlike the scavenger hunt it is built
 * from. A daily run is the strongest advert the mode has, and the person who
 * plays it every day is exactly the person who eventually unlocks the full
 * version — gating it would protect the paywall by starving the funnel.
 *
 * One run per person per UTC day, resumable: reopening the app mid-walk has to
 * return you to the run you were on, not start a fresh one that discards it.
 */
export async function startDailyHunt(
  gameRepo: GameRepository,
  dailyRepo: DailyHuntRepository,
  input: { userId: string },
  now = Date.now,
): Promise<Result<DailyHuntView>> {
  if (!input.userId) return err('Not signed in.');

  const dateKey = dailyKey(now());
  const items = dailyHuntList(dateKey);

  const existingId = await dailyRepo.get(input.userId, dateKey);
  if (existingId) {
    const existing = await gameRepo.get(existingId);
    if (existing) {
      return ok({ gameId: existing.id, dateKey, theme: dailyTheme(dateKey), items, resumed: true });
    }
  }

  const created = await createGame(
    gameRepo,
    {
      hostUserId: input.userId,
      tier: 'unlimited',
      config: {
        ...DEFAULT_CONFIG,
        mode: 'scavenger_hunt',
        huntTheme: dailyTheme(dateKey),
        photosPerRound: DAILY_ITEM_COUNT,
        // Solo: no judges, no special categories, nothing to vote on.
        maxTeams: 2,
        specialCategories: { presets: [], custom: [] },
        aiJudging: false,
        geofencing: false,
      },
    },
    now,
  );
  if (!created.ok) return created;

  // A solo hunt is still a game with a team, so every existing handler — photos,
  // claims, judging, results — works on it untouched.
  const joined = await joinByCode(gameRepo, {
    code: created.data.code,
    userId: input.userId,
    displayName: 'You',
    action: { type: 'create_team', name: 'You' },
  });
  if (!joined.ok) return joined;

  const game = (await gameRepo.get(created.data.gameId)) as Game;
  // `createGame` seeds a hunt from the game's own code, which would give every
  // player a different list. Replace it with the date-seeded one — the shared
  // list is the entire point. No wildcard: its reveal is timed from when *this*
  // player started, which would make the lists differ again.
  game.hunt = { items };
  await gameRepo.save(game);
  // The state machine needs two teams to start; a solo run has one real player,
  // so the run begins directly rather than through the host-start guard.
  await forceStart(gameRepo, game, input.userId, now);

  await dailyRepo.set(input.userId, dateKey, game.id);
  return ok({ gameId: game.id, dateKey, theme: dailyTheme(dateKey), items, resumed: false });
}

/**
 * Begin a solo run.
 *
 * `startGame` enforces a two-team minimum, which is right for a party game and
 * wrong for a solo one. Rather than weaken that guard for everybody, a solo run
 * is seeded with a second, empty "Par" team: the player is measured against a
 * shape that always scores nothing, so the ranking is meaningful and the real
 * start path — including its credit accounting — is the one that runs.
 */
async function forceStart(repo: GameRepository, game: Game, hostUserId: string, now: () => number): Promise<void> {
  await joinByCode(repo, {
    code: game.code,
    userId: `${hostUserId}::par`,
    displayName: 'Par',
    action: { type: 'create_team', name: 'Par' },
  });
  await startGame(repo, { gameId: game.id, hostUserId });
  const started = (await repo.get(game.id)) as Game;
  started.roundStartedAt ??= {};
  started.roundStartedAt.round1 ??= now();
  await repo.save(started);
}
