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

### Mode keys — what is actually shipped

Photo Chase is free. Every other mode is bought **or earned**, and the currency
is credited referrals — an invitee who installed *and* played a game to the end.
Attribution alone buys nothing, which is what makes install-farming pointless.

| Credited referrals | Mode unlocked |
|---|---|
| 1 | Scavenger Hunt |
| 3 | Colour Hunt |
| 5 | Photo Tag |

An earned mode is recorded on the entitlement itself (`unlockedModes`), additive
to whatever the tier grants and **permanent** — it survives a lapsed
subscription, because it was earned rather than rented. That is what makes the
unlock a real win rather than a trial.

Payout happens on the game's transition to `results`, not on a later batch job:
crediting that depends on someone remembering to run it is crediting that never
happens.

### Incentives that still work for a subscriber

A paying user has no use for a game credit or a mode key, so the program needs
rewards that money cannot already buy:

- **Your lobby plays at your tier.** Only the host's plan gates a game — already
  true of the engine, and now surfaced in the lobby ("everyone here is playing
  on the host's plan"). It is the most honest reason a subscriber has to invite
  people, and it costs nothing to give.
- **Flair.** Cosmetic status — Scout, Connector, Ringleader, Legend — that keeps
  climbing at 10 referrals, past the top of the mode ladder, so there is still
  something to chase once every mode is owned.
- **League creation as a paid power** (with tournaments): paid users create
  leagues, invitees join and play free.

### Consent is server-derived

The share-card gate reads who is depicted and who consented **from the game**,
never from the request. A client-supplied consent list would be one person
asserting everybody else's permission, which is precisely what the gate exists
to prevent. Since nothing can tell who is actually in frame, every member of a
depicted photo's team counts as depicted, and anything but an explicit yes
counts as withheld — the failure mode is publishing someone who said no.
Consent is revocable at any time; a yes that cannot be taken back is not consent.

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
