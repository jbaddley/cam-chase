/**
 * Social share cards for comparisons (docs/08) with a consent gate (docs/07):
 * a card depicting participants is only produced once every depicted, signed-in
 * participant has consented to sharing.
 */

export interface ShareCardInput {
  gameId: string;
  originalRef: string;
  chaseRef: string;
  originalTeamName: string;
  chaseTeamName: string;
  /** Short caption, e.g. "Best overall match!". */
  scoreStamp: string;
  /** The sharer's referral code, embedded in the deep link. */
  referralCode: string;
  /** Signed-in users visible in either photo. */
  depictedUserIds: string[];
}

export interface ShareCard {
  gameId: string;
  originalRef: string;
  chaseRef: string;
  originalTeamName: string;
  chaseTeamName: string;
  scoreStamp: string;
  shareUrl: string;
  status: 'active' | 'taken_down';
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Deep link that carries the referral code through install (deferred link). */
export function shareUrlFor(referralCode: string, gameId: string): string {
  return `https://photochase.app/s/${gameId}?ref=${referralCode}`;
}

/**
 * Build a share card only if every depicted participant has consented.
 * Returns the missing consenters otherwise.
 */
export function buildShareCard(input: ShareCardInput, consentedUserIds: Iterable<string>): Result<ShareCard> {
  const consented = new Set(consentedUserIds);
  const missing = input.depictedUserIds.filter((id) => !consented.has(id));
  if (missing.length > 0) {
    return { ok: false, error: `Missing sharing consent from: ${missing.join(', ')}` };
  }
  return {
    ok: true,
    data: {
      gameId: input.gameId,
      originalRef: input.originalRef,
      chaseRef: input.chaseRef,
      originalTeamName: input.originalTeamName,
      chaseTeamName: input.chaseTeamName,
      scoreStamp: input.scoreStamp,
      shareUrl: shareUrlFor(input.referralCode, input.gameId),
      status: 'active',
    },
  };
}

/** Mark a shared card as taken down at a depicted participant's request. */
export function takedown(card: ShareCard): ShareCard {
  return { ...card, status: 'taken_down' };
}
