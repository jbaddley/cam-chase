import {
  applyPurchaseEvent,
  buildShareCard,
  createAttribution,
  flairFor,
  generateReferralCode,
  grantCredit,
  grantModes,
  inviteUrlFor,
  modesEarnedAt,
  nextUnlock,
  runBudgetedJudging,
  StubJudge,
  type AiJudgement,
  type Flair,
  type Game,
  type GameEvent,
  type GameMode,
  type Judge,
  type JudgePair,
  type ShareCard,
} from '@photochase/shared';
import { z } from 'zod';
import type { EntitlementRepository } from './entitlements-repo.js';
import { advanceGame, type Result } from './handlers.js';
import type { AiJudgingRepository, ReferralRepository } from './growth-repo.js';
import { monthKey } from './growth-repo.js';
import type { GameRepository } from './repository.js';

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const err = (error: string): Result<never> => ({ ok: false, error });

/** Return a user's shareable referral code. */
export function issueReferralCode(userId: string): { code: string } {
  return { code: generateReferralCode(userId) };
}

/** A user's invite code and everything it has earned them so far. */
export interface ReferralView {
  code: string;
  inviteUrl: string;
  /** Invitees who installed *and* played a game through to the end. */
  creditedReferrals: number;
  /** Modes earned by referral, permanently, on top of whatever the tier gives. */
  modesEarned: GameMode[];
  /** The next rung and its distance, or null once the ladder is topped. */
  nextUnlock: { mode: GameMode; referralsAway: number } | null;
  /** Cosmetic status — the reward that still means something to a subscriber. */
  flair: Flair | null;
}

/**
 * The caller's own referral standing.
 *
 * Registering the code here is what makes it redeemable: `generateReferralCode`
 * is a one-way hash, so the index has to be written at the one moment we know
 * both halves. A user cannot share a code without first being shown it, so this
 * is the earliest an invitee could possibly arrive with one.
 */
export async function getMyReferral(repo: ReferralRepository, userId: string): Promise<Result<ReferralView>> {
  if (!userId) return err('Not signed in.');
  const { code } = issueReferralCode(userId);
  await repo.registerCode(code, userId);

  const creditedReferrals = await repo.countCreditedForReferrer(userId);
  return ok({
    code,
    inviteUrl: inviteUrlFor(code),
    creditedReferrals,
    modesEarned: modesEarnedAt(creditedReferrals),
    nextUnlock: nextUnlock(creditedReferrals),
    flair: flairFor(creditedReferrals),
  });
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

const RedeemInput = z.object({
  code: z.string().min(1).max(16),
  inviteeUserId: z.string().min(1),
});

/**
 * Redeem an invite code. Nothing is credited here — the referrer is paid only
 * once this invitee finishes a game, which is what makes install-farming
 * pointless. An invitee who already has a referral keeps it: first link wins,
 * so a code cannot be swapped in later to steal the credit.
 */
export async function redeemReferralCode(
  repo: ReferralRepository,
  raw: unknown,
  now = Date.now,
): Promise<Result<{ attributed: boolean; reason?: string }>> {
  const parsed = RedeemInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { code, inviteeUserId } = parsed.data;

  const existing = await repo.findByInvitee(inviteeUserId);
  if (existing) return ok({ attributed: false, reason: 'You already came in on an invite.' });

  const referrerUserId = await repo.findUserByCode(code.toUpperCase());
  if (!referrerUserId) return err('That invite code is not recognised.');

  return attributeReferral(repo, { referrerUserId, inviteeUserId, at: now() });
}

/**
 * Credit the referrer when their invitee finishes their first game — grants a
 * game credit, and any mode the referrer's lifetime total has now earned.
 * Honors the attribution window and the monthly cap.
 */
export async function creditReferralOnGameFinished(
  refRepo: ReferralRepository,
  entRepo: EntitlementRepository,
  input: { inviteeUserId: string; finishedAt: number },
): Promise<Result<{ credited: boolean; unlockedModes?: GameMode[]; reason?: string }>> {
  const referral = await refRepo.findByInvitee(input.inviteeUserId);
  if (!referral) return ok({ credited: false, reason: 'No referral for this invitee.' });

  const count = await refRepo.countCreditedForReferrerInMonth(referral.referrerUserId, monthKey(input.finishedAt));
  const granted = grantCredit(referral, input.finishedAt, count);
  if (!granted.ok) return ok({ credited: false, reason: granted.error });

  await refRepo.save(granted.data);

  // Read the lifetime total *after* saving, so this credit counts toward it.
  const lifetime = await refRepo.countCreditedForReferrer(referral.referrerUserId);
  const earned = modesEarnedAt(lifetime);

  const ent = await entRepo.getOrCreate(referral.referrerUserId);
  const paid = applyPurchaseEvent(ent, { type: 'game_pack_purchased', credits: 1 });
  await entRepo.save(grantModes(paid, earned));
  return ok({ credited: true, unlockedModes: earned });
}

/**
 * Credit every player's referrer once a game reaches results. Safe to call more
 * than once: the engine refuses to credit an already-credited referral, so a
 * replayed transition pays nobody twice.
 */
export async function creditReferralsForFinishedGame(
  gameRepo: GameRepository,
  refRepo: ReferralRepository,
  entRepo: EntitlementRepository,
  input: { gameId: string; finishedAt?: number },
  now = Date.now,
): Promise<Result<{ creditedUserIds: string[] }>> {
  const game = await gameRepo.get(input.gameId);
  if (!game) return err('Game not found.');

  const finishedAt = input.finishedAt ?? now();
  const creditedUserIds: string[] = [];
  for (const userId of new Set(game.memberships.map((m) => m.userId))) {
    const result = await creditReferralOnGameFinished(refRepo, entRepo, { inviteeUserId: userId, finishedAt });
    if (result.ok && result.data.credited) creditedUserIds.push(userId);
  }
  return ok({ creditedUserIds });
}

/**
 * Advance a game, paying out referrals the moment it reaches results.
 *
 * This is the seam that stops the referral engine being another built-but-never
 * called subsystem: crediting has to happen on the transition itself, not on
 * someone later remembering to run it.
 */
export async function advanceGameWithRewards(
  gameRepo: GameRepository,
  refRepo: ReferralRepository,
  entRepo: EntitlementRepository,
  input: { gameId: string; hostUserId: string; event: GameEvent['type'] },
  now = Date.now,
): Promise<Result<{ state: Game['state'] }>> {
  const advanced = await advanceGame(gameRepo, input);
  if (!advanced.ok) return advanced;
  if (advanced.data.state === 'results') {
    await creditReferralsForFinishedGame(gameRepo, refRepo, entRepo, { gameId: input.gameId, finishedAt: now() });
  }
  return advanced;
}

const ConsentInput = z.object({
  gameId: z.string().min(1),
  userId: z.string().min(1),
  consent: z.boolean(),
});

/**
 * Record whether a player agrees their photos may appear on a share card.
 * Revocable at any time — consent that cannot be withdrawn is not consent.
 */
export async function setSharingConsent(
  gameRepo: GameRepository,
  raw: unknown,
): Promise<Result<{ consent: boolean }>> {
  const parsed = ConsentInput.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { gameId, userId, consent } = parsed.data;

  const game = await gameRepo.get(gameId);
  if (!game) return err('Game not found.');
  const membership = game.memberships.find((m) => m.userId === userId);
  if (!membership) return err('You are not in this game.');

  membership.sharingConsent = consent;
  await gameRepo.save(game);
  return ok({ consent });
}

const ShareCardInputSchema = z.object({
  gameId: z.string().min(1),
  sharerUserId: z.string().min(1),
  originalPhotoId: z.string().min(1),
  chasePhotoId: z.string().min(1),
  scoreStamp: z.string().min(1).max(60),
});

/**
 * Build a share card for a comparison, enforcing the consent gate.
 *
 * Who is depicted and who consented are both read from the game, never taken
 * from the caller — a client that supplied its own consent list would be
 * asserting other people's permission, which is the whole thing the gate
 * exists to stop. Since nothing can tell who is actually in frame, every
 * member of a depicted photo's team counts as depicted: conservative by
 * design, because the failure mode is publishing someone who said no.
 */
export async function createShareCard(gameRepo: GameRepository, raw: unknown): Promise<Result<ShareCard>> {
  const parsed = ShareCardInputSchema.safeParse(raw);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input');
  const { gameId, sharerUserId, originalPhotoId, chasePhotoId, scoreStamp } = parsed.data;

  const game = await gameRepo.get(gameId);
  if (!game) return err('Game not found.');
  if (!game.memberships.some((m) => m.userId === sharerUserId)) return err('You are not in this game.');

  const original = game.photos.find((p) => p.id === originalPhotoId);
  const chase = game.photos.find((p) => p.id === chasePhotoId);
  if (!original || !chase) return err('Photo not found.');
  const teamName = (id: string) => game.teams.find((t) => t.id === id)?.name ?? 'Unknown';

  const depictedTeams = new Set([original.teamId, chase.teamId]);
  const depicted = game.memberships.filter((m) => m.teamId !== null && depictedTeams.has(m.teamId));

  const built = buildShareCard(
    {
      gameId: game.id,
      originalRef: original.s3Key,
      chaseRef: chase.s3Key,
      originalTeamName: teamName(original.teamId),
      chaseTeamName: teamName(chase.teamId),
      scoreStamp,
      referralCode: generateReferralCode(sharerUserId),
      depictedUserIds: depicted.map((m) => m.userId),
    },
    depicted.filter((m) => m.sharingConsent === true).map((m) => m.userId),
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
