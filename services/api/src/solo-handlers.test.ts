import { DAILY_ITEM_COUNT, dailyHuntList, dailyKey, type Game } from '@photochase/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getResults, listHuntItems, submitPhoto } from './handlers.js';
import { InMemoryGameRepository } from './repository.js';
import { startDailyHunt } from './solo-handlers.js';
import { InMemoryDailyHuntRepository } from './tournament-repo.js';

/**
 * The solo daily hunt exists for the moment someone opens the app and nobody
 * else is around. It is built entirely from the scavenger hunt, so what is
 * tested here is only what is specific to playing alone: the shared list, the
 * one-run-per-day rule, and resumability.
 */

let games: InMemoryGameRepository;
let daily: InMemoryDailyHuntRepository;

beforeEach(() => {
  games = new InMemoryGameRepository();
  daily = new InMemoryDailyHuntRepository();
});

async function unwrap<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.data;
}

const MONDAY = Date.UTC(2026, 6, 27, 9, 0);
const MONDAY_LATE = Date.UTC(2026, 6, 27, 22, 0);
const TUESDAY = Date.UTC(2026, 6, 28, 9, 0);

const start = (userId: string, at: number) => startDailyHunt(games, daily, { userId }, () => at);

describe('startDailyHunt', () => {
  it('starts a run that is already playable', async () => {
    const run = await unwrap(start('u1', MONDAY));
    const game = (await games.get(run.gameId)) as Game;
    expect(game.state).toBe('round1_active');
    expect(run.resumed).toBe(false);
  });

  it('gives everyone the same list on the same day', async () => {
    // A daily score is only worth comparing against a shared list.
    const mine = await unwrap(start('u1', MONDAY));
    const theirs = await unwrap(start('u2', MONDAY_LATE));
    expect(mine.items).toEqual(theirs.items);
    expect(mine.items).toEqual(dailyHuntList(dailyKey(MONDAY)));
  });

  it('gives a different list the next day', async () => {
    const monday = await unwrap(start('u1', MONDAY));
    const tuesday = await unwrap(start('u1', TUESDAY));
    expect(tuesday.items.map((i) => i.id)).not.toEqual(monday.items.map((i) => i.id));
    expect(tuesday.gameId).not.toBe(monday.gameId);
  });

  it('resumes the run in progress rather than discarding it', async () => {
    // Reopening the app mid-walk must not throw away what you already found.
    const first = await unwrap(start('u1', MONDAY));
    const again = await unwrap(start('u1', MONDAY_LATE));
    expect(again.gameId).toBe(first.gameId);
    expect(again.resumed).toBe(true);
  });

  it('keeps one person’s run separate from another’s', async () => {
    const mine = await unwrap(start('u1', MONDAY));
    const theirs = await unwrap(start('u2', MONDAY));
    expect(mine.gameId).not.toBe(theirs.gameId);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await start('', MONDAY)).ok).toBe(false);
  });

  it('is short enough to finish on a walk', async () => {
    const run = await unwrap(start('u1', MONDAY));
    expect(run.items).toHaveLength(DAILY_ITEM_COUNT);
  });
});

describe('playing a daily run', () => {
  it('serves the list through the ordinary hunt endpoint', async () => {
    // A solo run is a real game, so every existing handler works on it.
    const run = await unwrap(start('u1', MONDAY));
    const view = await unwrap(listHuntItems(games, { gameId: run.gameId, userId: 'u1' }));
    expect(view.items.map((i) => i.itemId).sort()).toEqual(run.items.map((i) => i.id).sort());
  });

  it('holds the date-seeded list on the game, not a per-game one', async () => {
    // `createGame` seeds a hunt from the game code; left alone that would give
    // every player a different list and quietly break the whole premise.
    const mine = await unwrap(start('u1', MONDAY));
    const theirs = await unwrap(start('u2', MONDAY));
    const mineGame = (await games.get(mine.gameId)) as Game;
    const theirsGame = (await games.get(theirs.gameId)) as Game;

    expect(mineGame.hunt!.items).toEqual(theirsGame.hunt!.items);
    expect(mineGame.hunt!.items).toEqual(dailyHuntList(dailyKey(MONDAY)));
    // No wildcard: its reveal is timed per player, which would diverge the lists.
    expect(mineGame.hunt!.wildcardItemId).toBeUndefined();
  });

  it('scores a find through the ordinary scavenger scorer', async () => {
    const run = await unwrap(start('u1', MONDAY));
    const game = (await games.get(run.gameId)) as Game;
    const mine = game.teams.find((t) => t.name === 'You')!;

    await unwrap(
      submitPhoto(
        games,
        { gameId: run.gameId, teamId: mine.id, shooterUserId: 'u1', location: { lat: 40, lng: -74 }, s3Key: 'p1', itemId: run.items[0]!.id },
        () => MONDAY,
      ),
    );

    const advanced = (await games.get(run.gameId)) as Game;
    advanced.state = 'rating';
    await games.save(advanced);

    const { scoreboard } = await unwrap(getResults(games, run.gameId));
    expect(scoreboard.find((s) => s.teamId === mine.id)!.location).toBeGreaterThan(0);
  });

  it('measures the player against a par that always scores nothing', async () => {
    // A solo run still needs a ranking, and the state machine still needs two
    // teams; an empty par team satisfies both without weakening the guard.
    const run = await unwrap(start('u1', MONDAY));
    const game = (await games.get(run.gameId)) as Game;
    expect(game.teams.map((t) => t.name).sort()).toEqual(['Par', 'You']);
    expect(game.photos).toHaveLength(0);
  });
});
