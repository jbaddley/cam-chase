/**
 * Referral program (docs/08-growth-referrals.md). Credit is granted on the
 * invitee's first FINISHED game (not install), inside an attribution window,
 * with anti-abuse caps and no self-referral.
 */

export const ATTRIBUTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_CREDITS_PER_MONTH = 10;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Deterministic, shareable referral code for a user. */
export function generateReferralCode(userId: string): string {
  let h = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let code = '';
  let n = h >>> 0;
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[n % CODE_ALPHABET.length];
    n = Math.floor(n / CODE_ALPHABET.length) || (h ^ (i + 1)) >>> 0;
  }
  return code;
}

export interface Referral {
  code: string;
  referrerUserId: string;
  inviteeUserId: string;
  attributedAt: number;
  credited: boolean;
  activatedAt?: number;
  revoked?: boolean;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Attribute an invitee to a referrer at signup. Rejects self-referral. */
export function createAttribution(input: {
  referrerUserId: string;
  inviteeUserId: string;
  at: number;
}): Result<Referral> {
  if (input.referrerUserId === input.inviteeUserId) {
    return { ok: false, error: 'Self-referral is not allowed.' };
  }
  return {
    ok: true,
    data: {
      code: generateReferralCode(input.referrerUserId),
      referrerUserId: input.referrerUserId,
      inviteeUserId: input.inviteeUserId,
      attributedAt: input.at,
      credited: false,
    },
  };
}

/** Whether a referral is eligible to be credited at `finishedAt`. */
export function qualifiesForCredit(referral: Referral, finishedAt: number): boolean {
  if (referral.credited || referral.revoked) return false;
  const elapsed = finishedAt - referral.attributedAt;
  return elapsed >= 0 && elapsed <= ATTRIBUTION_WINDOW_MS;
}

/**
 * Grant credit for the invitee's first finished game. Enforces the window and
 * the referrer's monthly cap.
 */
export function grantCredit(
  referral: Referral,
  finishedAt: number,
  referrerCreditsThisMonth: number,
): Result<Referral> {
  if (!qualifiesForCredit(referral, finishedAt)) {
    return { ok: false, error: 'Referral is not eligible for credit.' };
  }
  if (referrerCreditsThisMonth >= MAX_CREDITS_PER_MONTH) {
    return { ok: false, error: 'Monthly referral credit cap reached.' };
  }
  return { ok: true, data: { ...referral, credited: true, activatedAt: finishedAt } };
}

/** Revoke a credited referral (e.g., on the invitee's refund/chargeback). */
export function revokeCredit(referral: Referral): Referral {
  return { ...referral, credited: false, revoked: true };
}
