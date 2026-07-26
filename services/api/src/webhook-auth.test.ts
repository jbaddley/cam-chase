import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  HmacSignatureVerifier,
  MAX_SIGNATURE_AGE_MS,
  RejectingVerifier,
  SharedSecretVerifier,
  webhookVerifierFromEnv,
} from './webhook-auth.js';

const SECRET = 'whsec_supersecret';
const BODY = JSON.stringify({ userId: 'u1', event: { type: 'subscription_started', expiresAt: 1 } });

/** Build a Stripe-style signature header over `<timestamp>.<body>`. */
function sign(body: string, atMs: number, secret = SECRET): string {
  const t = Math.floor(atMs / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

describe('SharedSecretVerifier', () => {
  const verifier = new SharedSecretVerifier(SECRET);

  it('accepts the correct bearer secret', () => {
    expect(verifier.verify(BODY, { authorization: `Bearer ${SECRET}` })).toBeNull();
  });

  it('accepts the secret without the Bearer prefix', () => {
    expect(verifier.verify(BODY, { authorization: SECRET })).toBeNull();
  });

  it('reads the header regardless of casing', () => {
    expect(verifier.verify(BODY, { Authorization: `Bearer ${SECRET}` })).toBeNull();
  });

  it('rejects a wrong secret, a shorter one, and a missing header', () => {
    expect(verifier.verify(BODY, { authorization: 'Bearer wrong' })).toBeTruthy();
    expect(verifier.verify(BODY, { authorization: `Bearer ${SECRET.slice(0, -1)}` })).toBeTruthy();
    expect(verifier.verify(BODY, {})).toBeTruthy();
  });
});

describe('HmacSignatureVerifier', () => {
  const now = 1_700_000_000_000;
  const verifier = new HmacSignatureVerifier(SECRET, () => now);

  it('accepts a signature over the exact body', () => {
    expect(verifier.verify(BODY, { 'stripe-signature': sign(BODY, now) })).toBeNull();
  });

  it('rejects a tampered body', () => {
    const signature = sign(BODY, now);
    const tampered = BODY.replace('"u1"', '"attacker"');
    expect(verifier.verify(tampered, { 'stripe-signature': signature })).toBe('Invalid webhook signature.');
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifier.verify(BODY, { 'stripe-signature': sign(BODY, now, 'other') })).toBe('Invalid webhook signature.');
  });

  it('rejects a replayed signature older than the window', () => {
    const stale = sign(BODY, now - MAX_SIGNATURE_AGE_MS - 1_000);
    expect(verifier.verify(BODY, { 'stripe-signature': stale })).toBe('Webhook signature has expired.');
  });

  it('accepts one inside the window', () => {
    const recent = sign(BODY, now - MAX_SIGNATURE_AGE_MS + 1_000);
    expect(verifier.verify(BODY, { 'stripe-signature': recent })).toBeNull();
  });

  it('rejects a future-dated signature beyond the window', () => {
    const future = sign(BODY, now + MAX_SIGNATURE_AGE_MS + 1_000);
    expect(verifier.verify(BODY, { 'stripe-signature': future })).toBe('Webhook signature has expired.');
  });

  it('rejects malformed and missing signatures', () => {
    expect(verifier.verify(BODY, { 'stripe-signature': 'garbage' })).toBe('Malformed webhook signature.');
    expect(verifier.verify(BODY, { 'stripe-signature': 't=abc,v1=def' })).toBe('Malformed webhook signature.');
    expect(verifier.verify(BODY, {})).toBe('Missing webhook signature.');
  });
});

describe('RejectingVerifier', () => {
  it('refuses everything', () => {
    expect(new RejectingVerifier().verify()).toBeTruthy();
  });
});

describe('webhookVerifierFromEnv', () => {
  it('prefers the HMAC secret when both are set', () => {
    const verifier = webhookVerifierFromEnv({
      PURCHASE_WEBHOOK_HMAC_SECRET: SECRET,
      PURCHASE_WEBHOOK_SECRET: 'other',
    } as NodeJS.ProcessEnv);
    expect(verifier).toBeInstanceOf(HmacSignatureVerifier);
  });

  it('falls back to the shared secret', () => {
    const verifier = webhookVerifierFromEnv({ PURCHASE_WEBHOOK_SECRET: SECRET } as NodeJS.ProcessEnv);
    expect(verifier).toBeInstanceOf(SharedSecretVerifier);
  });

  it('rejects by default when nothing is configured', () => {
    // Failing closed is the point: a deployment that forgets the secret must
    // not hand out entitlements to anyone who finds the URL.
    const verifier = webhookVerifierFromEnv({} as NodeJS.ProcessEnv);
    expect(verifier).toBeInstanceOf(RejectingVerifier);
    expect(verifier.verify('', {})).toBeTruthy();
  });
});
