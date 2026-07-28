import type { GameRepository } from './repository.js';

/**
 * Walk every team back to the start point, for fixtures that need a game further
 * along than the phase they care about.
 *
 * Test-only. It lives in `src` so the test files can import it without reaching
 * outside the package, and it never reaches the Lambda: the bundle is built from
 * `lambda.ts`, so a module nothing on that path imports is not included at all.
 *
 * Fixtures could pass `force: true` instead, and it would be one word rather
 * than a call. They do this instead because a suite that forces its way past the
 * gate everywhere stops exercising it everywhere, and the gate is the thing most
 * likely to be broken by accident later. Where a test *is* about forcing, it
 * passes `force` and says so.
 */
export async function bringEveryoneBack(
  repo: GameRepository,
  gameId: string,
  round: 'round1' | 'round2',
  at = 1_000,
): Promise<void> {
  const game = await repo.get(gameId);
  if (!game) throw new Error(`bringEveryoneBack: no game ${gameId}`);
  for (const team of game.teams) {
    const member = game.memberships.find((m) => m.teamId === team.id);
    if (member) member.returnCheckins[round] ??= at;
  }
  await repo.save(game);
}
