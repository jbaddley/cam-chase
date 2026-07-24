# 08 – Growth, Referrals & Social Sharing

## The organic engine: share cards

Every finished game produces inherently funny, inherently shareable artifacts — side-by-side original-vs-chase comparisons. This is the primary acquisition channel and it's free:

- Server-rendered **OG share cards** (Lambda + CloudFront): comparison image pair, team names, score stamp, PhotoChase branding, and a join/download link with the sharer's referral code baked in.
- One-tap share via OS share sheet → Instagram, X, Facebook, WhatsApp, Messages. Links unfurl as rich cards on X/Facebook; Instagram receives the composed image.
- Post-game "shareable moments" screen surfaces the top 3 comparisons + winner card so sharing is the natural last step of every game.
- Every share passes the consent gate (doc 07) — people in the photo must be OK with it.

## Referral program

**Mechanic:** every user has a permanent referral code and deep link (shown in-app, embedded in share cards and QR invites).

- **Attribution:** deep link → app store → deferred deep link on first open carries the code through install (Branch.io, or Expo Linking + server-side install attribution). Manually enterable code as fallback ("Who sent you?" on signup, editable for 7 days).
- **Credit trigger: the invitee finishes their first game** — not mere install. Playing a game is the honest activation metric and is far harder to fraud than installs.
- **Rewards ladder (both sides get something):**

| Milestone | Referrer gets | Invitee gets |
|-----------|--------------|--------------|
| Friend finishes first game | 1 free Tier-2-quality hosted game credit | Their first hosted game is Tier-2 quality free |
| 3 activated referrals | 1 month of Tier 3 free | — |
| 10 activated referrals | 3 months of Tier 3 + "Founder" profile badge | — |

- **Anti-abuse:** device fingerprint + payment-instrument dedupe, credit caps per month, no self-referral (same device/instrument), credits revoked on refund/chargeback patterns, velocity alarms. Rewards are always feature credits, never cash — caps the downside.
- Referral state lives in the `Referral` entity (doc 02); attribution window 90 days.

## Built-in viral loops (beyond the program)

- **The QR invite is an acquisition funnel:** joiners without the app land on a store page and the game code survives install — measure this conversion specifically; it's the app's best funnel (a friend is literally waiting).
- **Spectator/judge links** let remote friends and family into the fun with zero commitment — each one is a warm lead who watched a full game.
- **Winner cards** are personalized brag material; losing teams get a "demand a rematch" card that pre-creates a game lobby.
- Post-game email/push (opt-in): "Your game album is ready" with share prompts.

## Marketing site

- Playful single-page marketing site (Next.js, doc 02): hero video of a real game, how-it-works in 3 steps, pricing, live demo of the big-screen view, store badges, localized per doc 06.
- SEO/OG-ready; referral links land here with the code preserved through to store handoff.
- Hosts a "start a game from the web" path — create the game on desktop, continue on phone via QR (also demonstrates the product's QR loop to first-timers).
