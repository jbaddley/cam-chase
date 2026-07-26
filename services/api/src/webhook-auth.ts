import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Purchase-webhook authentication.
 *
 * This endpoint grants entitlements, so an unverified request is a free
 * upgrade for anyone who can reach the URL. Every request must prove it came
 * from the provider before any event is applied.
 *
 * Two schemes are supported, matching the providers in docs/03:
 *  - RevenueCat sends a shared secret in the `Authorization` header.
 *  - Stripe signs `timestamp.payload` with HMAC-SHA256 and sends both in
 *    `stripe-signature`.
 */

export interface WebhookVerifier {
  /** Verify raw body + headers. Returns why it failed, or null when valid. */
  verify(rawBody: string, headers: Record<string, string | undefined>): string | null;
}

/** Reject signatures older than this, so a captured grant cannot be replayed. */
export const MAX_SIGNATURE_AGE_MS = 5 * 60_000;

/** Case-insensitive header lookup; gateways do not agree on casing. */
function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return found?.[1];
}

/** Constant-time compare that never leaks length through early exit. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Still burn a comparison so a wrong length is not faster to detect.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** RevenueCat: a shared secret presented as `Authorization: Bearer <secret>`. */
export class SharedSecretVerifier implements WebhookVerifier {
  constructor(private readonly secret: string) {}

  verify(_rawBody: string, headers: Record<string, string | undefined>): string | null {
    const authorization = header(headers, 'authorization');
    if (!authorization) return 'Missing Authorization header.';
    const presented = authorization.replace(/^Bearer\s+/i, '');
    return safeEqual(presented, this.secret) ? null : 'Invalid webhook credentials.';
  }
}

/**
 * Stripe-style: `stripe-signature: t=<unix seconds>,v1=<hex hmac>` where the
 * HMAC covers `<t>.<rawBody>`. Signing the timestamp alongside the body is what
 * makes replay detectable — a captured request cannot be re-dated.
 */
export class HmacSignatureVerifier implements WebhookVerifier {
  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
    private readonly headerName = 'stripe-signature',
  ) {}

  verify(rawBody: string, headers: Record<string, string | undefined>): string | null {
    const signature = header(headers, this.headerName);
    if (!signature) return 'Missing webhook signature.';

    const parts = new Map(
      signature.split(',').map((part) => {
        const [key, value] = part.trim().split('=');
        return [key ?? '', value ?? ''] as const;
      }),
    );
    const timestamp = parts.get('t');
    const provided = parts.get('v1');
    if (!timestamp || !provided) return 'Malformed webhook signature.';

    const signedAt = Number(timestamp) * 1000;
    if (!Number.isFinite(signedAt)) return 'Malformed webhook signature.';
    if (Math.abs(this.now() - signedAt) > MAX_SIGNATURE_AGE_MS) return 'Webhook signature has expired.';

    const expected = createHmac('sha256', this.secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return safeEqual(provided, expected) ? null : 'Invalid webhook signature.';
  }
}

/** Refuses everything, with an explanation. Used when no secret is configured. */
export class RejectingVerifier implements WebhookVerifier {
  verify(): string {
    return 'Purchase webhooks are not configured.';
  }
}

/**
 * Build the verifier from the environment. Configuring nothing yields a
 * verifier that rejects: a deployment missing its secret must not silently
 * accept unsigned grants, which is exactly how this endpoint was exploitable.
 */
export function webhookVerifierFromEnv(env: NodeJS.ProcessEnv = process.env): WebhookVerifier {
  if (env.PURCHASE_WEBHOOK_HMAC_SECRET) return new HmacSignatureVerifier(env.PURCHASE_WEBHOOK_HMAC_SECRET);
  if (env.PURCHASE_WEBHOOK_SECRET) return new SharedSecretVerifier(env.PURCHASE_WEBHOOK_SECRET);
  return new RejectingVerifier();
}
