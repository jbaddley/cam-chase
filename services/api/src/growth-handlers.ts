import {
  applyPurchaseEvent,
  buildShareCard,
  createAttribution,
  generateReferralCode,
  grantCredit,
  runBudgetedJudging,
  StubJudge,
  type AiJudgement,
  type Judge,
  type JudgePair,
  type ShareCard,
} from '@photochase/shared';
import type { EntitlementRepository } from './entitlements-repo.js';
import type { Result } from './handlers.js';
import type { AiJudgingRepository, ReferralRepository } from './growth-repo.js';
import { monthKey } from './growth-repo.js';
import type { GameRepository } from './repository.js';

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const err = (error: string): Result<never> => ({ ok: false, error });

/** Return a user's shareable referral code. */
export function issueReferralCode(userId: string): { code: string } {
  return { code: generateReferralCode(userId) };
}

/** Attribute an invitee to a referrer at signup. */
export async function attributeReferral(
  repo: ReferralRepository,
  input: { referrerUserId: string; inviteeUserId: string; at: number },
): Promise<Result<{ attributed: boolean }>> {
  const attribution = createAttribution(input);
  if (!attribution.ok) return err(attribution.error);
  await repo.save(attribution.data);
  return ok({ attributed: true });
}

/**
 * Credit the referrer when their invitee finishes their first game — grants the
 * referrer a game credit via a synthetic purchase event. Honors window + cap.
 */
export async function creditReferralOnGameFinished(
  refRepo: ReferralRepository,
  entRepo: EntitlementRepository,
  input: { inviteeUserId: string; finishedAt: number },
): Promise<Result<{ credited: boolean; reason?: string }>> {
  const referral = await refRepo.findByInvitee(input.inviteeUserId);
  if (!referral) return ok({ credited: false, reason: 'No referral for this invitee.' });

  const count = await refRepo.countCreditedForReferrerInMonth(referral.referrerUserId, monthKey(input.finishedAt));
  const granted = grantCredit(referral, input.finishedAt, count);
  if (!granted.ok) return ok({ credited: false, reason: granted.error });

  await refRepo.save(granted.data);
  const ent = await entRepo.getOrCreate(referral.referrerUserId);
  await entRepo.save(applyPurchaseEvent(ent, { type: 'game_pack_purchased', credits: 1 }));
  return ok({ credited: true });
}

/** Build a share card for a comparison, enforcing the consent gate. */
export async function createShareCard(
  gameRepo: GameRepository,
  input: {
    gameId: string;
    originalPhotoId: string;
    chasePhotoId: string;
    scoreStamp: string;
    referralCode: string;
    depictedUserIds: string[];
    consentedUserIds: string[];
  },
): Promise<Result<ShareCard>> {
  const game = await gameRepo.get(input.gameId);
  if (!game) return err('Game not found.');
  const original = game.photos.find((p) => p.id === input.originalPhotoId);
  const chase = game.photos.find((p) => p.id === input.chasePhotoId);
  if (!original || !chase) return err('Photo not found.');
  const teamName = (id: string) => game.teams.find((t) => t.id === id)?.name ?? 'Unknown';

  const built = buildShareCard(
    {
      gameId: game.id,
      originalRef: original.s3Key,
      chaseRef: chase.s3Key,
      originalTeamName: teamName(original.teamId),
      chaseTeamName: teamName(chase.teamId),
      scoreStamp: input.scoreStamp,
      referralCode: input.referralCode,
      depictedUserIds: input.depictedUserIds,
    },
    input.consentedUserIds,
  );
  return built.ok ? ok(built.data) : err(built.error);
}

/** Judge a game's completed chases within the AI budget and store the scores. */
export async function runGameJudging(
  gameRepo: GameRepository,
  aiRepo: AiJudgingRepository,
  input: { gameId: string; budgetCents?: number; killSwitch?: boolean },
  judge: Judge = new StubJudge(),
): Promise<Result<{ judgedCount: number; skippedCount: number; degraded: boolean; killed: boolean }>> {
  const game = await gameRepo.get(input.gameId);
  if (!game) return err('Game not found.');
  if (!game.config.aiJudging) return err('AI judging is not enabled for this game.');

  const s3Key = (photoId: string | null) => game.photos.find((p) => p.id === photoId)?.s3Key;
  const pairs: JudgePair[] = [];
  for (const a of game.assignments) {
    const originalRef = s3Key(a.originalPhotoId);
    const chaseRef = s3Key(a.chasePhotoId);
    if (originalRef && chaseRef) {
      pairs.push({ assignmentId: a.id, originalRef, chaseRef });
    }
  }

  const result = await runBudgetedJudging(judge, pairs, {
    budgetCents: input.budgetCents,
    killSwitch: input.killSwitch,
  });
  const judgements: AiJudgement[] = result.judgements;
  await aiRepo.save(game.id, judgements);
  return ok({
    judgedCount: result.judgedCount,
    skippedCount: result.skippedCount,
    degraded: result.degraded,
    killed: result.killed,
  });
}
