import {
  applyPurchaseEvent,
  canHostConfig,
  availableModes,
  canStartGame,
  canUseFeature,
  consumeGameCredit,
  GameConfigSchema,
  refundGameCredit,
  TIER_LIMITS,
  type Entitlement,
  type Feature,
  type Game,
  type GameMode,
  type PurchaseEvent,
  type Tier,
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

/** What the client needs to render a paywall without hardcoding the matrix. */
export interface EntitlementView {
  tier: Tier;
  /** Remaining one-time game credits (game_pack tier). */
  gameCredits: number;
  subscriptionActive: boolean;
  subscriptionExpiresAt?: number;
  /** Whether this user can start another game right now, and why not. */
  canStartGame: boolean;
  cannotStartReason?: string;
  /** The tier's limits, so the client renders real numbers, not guesses. */
  limits: (typeof TIER_LIMITS)[Tier];
  /** Modes this user may host: the tier's, plus any earned by referral. */
  modes: GameMode[];
  /** Feature flags keyed by feature name. */
  features: Record<Feature, boolean>;
}

const FEATURES: Feature[] = [
  'ai_judging',
  'geofencing',
  'special_categories',
  'random_game_type',
  'judge_weight_over_1',
  'up_to_6_teams',
];

/**
 * The caller's own entitlement. Returned to the client so it can show what the
 * user has, what they are missing, and whether another game is available —
 * without duplicating the tier matrix, which would drift from the server's.
 */
export async function getMyEntitlement(
  entRepo: EntitlementRepository,
  userId: string,
): Promise<Result<EntitlementView>> {
  if (!userId) return err('Not signed in.');
  const entitlement = await entRepo.getOrCreate(userId);
  const startable = canStartGame(entitlement);

  const features = Object.fromEntries(
    FEATURES.map((feature) => [feature, canUseFeature(entitlement.tier, feature)]),
  ) as Record<Feature, boolean>;

  return ok({
    tier: entitlement.tier,
    gameCredits: entitlement.gameCredits,
    subscriptionActive: entitlement.subscriptionActive,
    ...(entitlement.subscriptionExpiresAt !== undefined
      ? { subscriptionExpiresAt: entitlement.subscriptionExpiresAt }
      : {}),
    canStartGame: startable.ok,
    ...(startable.reason ? { cannotStartReason: startable.reason } : {}),
    limits: TIER_LIMITS[entitlement.tier],
    modes: availableModes(entitlement),
    features,
  });
}

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
