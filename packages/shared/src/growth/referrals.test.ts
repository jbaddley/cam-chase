import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_WINDOW_MS,
  createAttribution,
  generateReferralCode,
  grantCredit,
  MAX_CREDITS_PER_MONTH,
  qualifiesForCredit,
  revokeCredit,
  type Referral,
} from './referrals.js';

describe('generateReferralCode', () => {
  it('is deterministic and 6 characters', () => {
    expect(generateReferralCode('user-1')).toBe(generateReferralCode('user-1'));
    expect(generateReferralCode('user-1')).toHaveLength(6);
    expect(generateReferralCode('user-1')).not.toBe(generateReferralCode('user-2'));
  });
});

describe('createAttribution', () => {
  it('creates a pending referral', () => {
    const r = createAttribution({ referrerUserId: 'a', inviteeUserId: 'b', at: 1000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.credited).toBe(false);
  });

  it('rejects self-referral', () => {
    expect(createAttribution({ referrerUserId: 'a', inviteeUserId: 'a', at: 1 }).ok).toBe(false);
  });
});

describe('credit lifecycle', () => {
  const base: Referral = { code: 'ABC123', referrerUserId: 'a', inviteeUserId: 'b', attributedAt: 1000, credited: false };

  it('grants credit for a first finished game within the window', () => {
    const r = grantCredit(base, 1000 + ATTRIBUTION_WINDOW_MS - 1, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.credited).toBe(true);
      expect(r.data.activatedAt).toBeDefined();
    }
  });

  it('does not credit past the attribution window', () => {
    expect(qualifiesForCredit(base, 1000 + ATTRIBUTION_WINDOW_MS + 1)).toBe(false);
    expect(grantCredit(base, 1000 + ATTRIBUTION_WINDOW_MS + 1, 0).ok).toBe(false);
  });

  it('does not double-credit', () => {
    const credited: Referral = { ...base, credited: true };
    expect(grantCredit(credited, 2000, 0).ok).toBe(false);
  });

  it('enforces the monthly cap', () => {
    expect(grantCredit(base, 2000, MAX_CREDITS_PER_MONTH).ok).toBe(false);
    expect(grantCredit(base, 2000, MAX_CREDITS_PER_MONTH - 1, ).ok).toBe(true);
  });

  it('revokes on refund and blocks re-credit', () => {
    const revoked = revokeCredit({ ...base, credited: true });
    expect(revoked.credited).toBe(false);
    expect(revoked.revoked).toBe(true);
    expect(qualifiesForCredit(revoked, 2000)).toBe(false);
  });
});
