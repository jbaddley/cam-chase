import {
  applyPurchaseEvent,
  canHostConfig,
  canStartGame,
  consumeGameCredit,
  GameConfigSchema,
  refundGameCredit,
  type Entitlement,
  type Game,
  type PurchaseEvent,
} from '@photochase/shared';
import { z } from 'zod';
import { createGame, startGame, type Result } from './handlers.js';
import type { EntitlementRepository } from './entitlements-repo.js';
import type { GameRepository } from './repository.js';

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const err = (error: string): Result<never> => ({ ok: false, error });

/**
 * Create a game using the host's entitlement to determine tier and gate the
 * config — the client never chooses its own tier.
 */
export async function createGameForHost(
  gameRepo: GameRepository,
  entRepo: EntitlementRepository,
  raw: unknown,
): Promise<Result<{ gameId: string; code: string }>> {
  const parsed = z.object({ hostUserId: z.string().min(1), config: GameConfigSchema }).safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { hostUserId, config } = parsed.data;

  const entitlement = await entRepo.getOrCreate(hostUserId);
  const gate = canHostConfig(entitlement, config);
  if (!gate.ok) return err(gate.errors.join(' '));

  return createGame(gameRepo, { hostUserId, tier: entitlement.tier, config });
}

/**
 * Start a game, consuming a game credit for one-time tiers. If the start fails
 * (e.g., too few teams), the credit is refunded so nothing is lost.
 */
export async function startGameForHost(
  gameRepo: GameRepository,
  entRepo: EntitlementRepository,
  input: { gameId: string; hostUserId: string },
): Promise<Result<{ state: Game['state'] }>> {
  const entitlement = await entRepo.getOrCreate(input.hostUserId);
  const startable = canStartGame(entitlement);
  if (!startable.ok) return err(startable.reason ?? 'Cannot start game.');

  const consumed = consumeGameCredit(entitlement);
  await entRepo.save(consumed);

  const started = await startGame(gameRepo, input);
  if (!started.ok) {
    await entRepo.save(refundGameCredit(consumed)); // roll back the credit
    return started;
  }
  return started;
}

/** Refund a game credit when a game is abandoned before it starts. */
export async function abandonGame(
  gameRepo: GameRepository,
  entRepo: EntitlementRepository,
  input: { gameId: string; hostUserId: string },
): Promise<Result<{ refunded: boolean }>> {
  const game = await gameRepo.get(input.gameId);
  if (!game) return err('Game not found.');
  if (game.hostUserId !== input.hostUserId) return err('Only the host can abandon the game.');
  if (game.state !== 'lobby' && game.state !== 'draft') {
    return err('A game that has started cannot be abandoned for a refund.');
  }
  const entitlement = await entRepo.getOrCreate(input.hostUserId);
  await entRepo.save(refundGameCredit(entitlement));
  return ok({ refunded: true });
}

const PurchaseWebhookInput = z.object({
  userId: z.string().min(1),
  event: z.discriminatedUnion('type', [
    z.object({ type: z.literal('game_pack_purchased'), credits: z.number().int().positive() }),
    z.object({ type: z.literal('game_pack_refunded'), credits: z.number().int().positive() }),
    z.object({ type: z.literal('subscription_started'), expiresAt: z.number().int() }),
    z.object({ type: z.literal('subscription_renewed'), expiresAt: z.number().int() }),
    z.object({ type: z.literal('subscription_cancelled') }),
    z.object({ type: z.literal('subscription_expired') }),
  ]),
});

/**
 * Apply a normalized store/webhook event (RevenueCat/Stripe map onto this
 * shape) to a user's entitlement.
 */
export async function handlePurchaseWebhook(
  entRepo: EntitlementRepository,
  raw: unknown,
): Promise<Result<Entitlement>> {
  const parsed = PurchaseWebhookInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid webhook');
  const { userId, event } = parsed.data;
  const entitlement = await entRepo.getOrCreate(userId);
  const next = applyPurchaseEvent(entitlement, event as PurchaseEvent);
  await entRepo.save(next);
  return ok(next);
}
