# 03 – Pricing & Monetization

## Store economics (the "Apple cost" reality)

| Channel | Standard cut | Reduced cut | How to get the reduced cut |
|---------|-------------|-------------|----------------------------|
| Apple App Store | 30% | **15%** | **App Store Small Business Program** — first $1M/yr in proceeds. Enroll before launch |
| Apple subscriptions | 30% year 1 | 15% | Automatic after a subscriber's 13th month |
| Google Play | 30% | **15%** | 15% on first $1M/yr — enroll in the reduced service fee tier |
| Stripe (web checkout) | ~2.9% + $0.30 | — | Web-originated purchases only |

**Recommendations:**

1. **Enroll in both small-business programs immediately.** Until revenue passes $1M/yr, the effective store cut is 15%, not 30%. Model margins at 15% but stress-test every price at 30% so growth doesn't break the business.
2. **Push web checkout where legal.** The marketing site sells Tier 2/3 via Stripe at ~97% net. Inside the iOS app, use IAP as required; enable external-purchase links only behind per-storefront remote config where permitted (US anti-steering entitlement, EU DMA).
3. **Subscriptions beat one-time purchases on margin** once retention passes a year (Apple drops to 15% automatically). Design the funnel to land people in Tier 3.

## Recommended pricing

| Tier | Price | What you get | Net @15% | Net @30% |
|------|-------|--------------|----------|----------|
| **Tier 1 — Free** | $0 | 2 teams, ads, fixed config, no AI, coarse GPS scoring | ad revenue only | — |
| **Tier 2 — Game Pack** | **$3.99 one-time** (launch promo $2.99) | 2 hosted games, up to 6 teams, full config, full AI, full GPS/geofencing | ~$3.39 | ~$2.79 |
| **Tier 3 — Unlimited** | **$5.99/mo**, cancel anytime | Unlimited games, everything in Tier 2 | ~$5.09/mo | ~$4.19/mo |
| Intro deal | **$9.99 first 3 months, then $5.99/mo** | Native store intro-offer mechanics via RevenueCat | | |
| **Annual** | **$39.99/yr** (~44% off monthly) | Recommended addition — best LTV/retention lever | ~$34 | ~$28 |
| Lifetime | **$29.99, limited launch offer only** | See warning below | ~$25.49 | ~$21 |

**Pricing advice (requested):**

- **Raise Tier 2 from $2.99 to $3.99.** One-time buyers are the worst-margin segment (store cut + full AI/GPS COGS, no recurring revenue). $3.99 is still an impulse purchase, nets ~33% more per sale, and lets $2.99 live on as a promotional price with intro-offer framing ("launch special").
- **Keep $5.99/mo** — right in the casual-subscription comfort band, and only the host pays, so per-game cost split across a party is trivially cheap. Lead marketing with "one subscription covers everyone you play with."
- **Lifetime at $29.99 is a margin risk**, not a product: it's ~5 months of Tier 3 revenue against unlimited AI-judged games forever. Offer it only as a scarcity launch promo, and either cap AI-judged games per month on lifetime plans (e.g., 8/month, generous but bounded) or retire the SKU after launch.
- **Regional pricing:** use store price tiers to localize (LatAm, India price sensitivity); Stripe checkout uses Purchasing-Power-Parity-informed price points.

## Margin model

Per-game COGS (paid game, 6 teams, 15 photos/team, AI on):

| Cost item | Estimate |
|-----------|----------|
| S3 + CloudFront (photos, ~200 MB traffic) | ~$0.03 |
| Lambda/DynamoDB/API/websockets | ~$0.02 |
| Rekognition face pre-checks (~180 images) | ~$0.18 → mitigated to ~$0.05 with on-device detection first (see doc 04) |
| LLM pairwise judging (90 pairs, small vision model, capped) | ~$0.10–0.25 (hard cap $0.30) |
| **Total per game** | **≈ $0.20–0.40** |

| Plan | Net revenue | Games covered | Margin |
|------|-------------|---------------|--------|
| Tier 2 @ $3.99 (15% cut) | $3.39 | 2 games ≈ $0.80 COGS worst case | **~76%** |
| Tier 2 @ $3.99 (30% cut) | $2.79 | | ~71% |
| Tier 3 @ $5.99/mo (15%) | $5.09 | typical 2–4 games/mo ≈ $0.60–1.60 | **~69–88%** |
| Heavy Tier 3 user (10 games/mo) | $5.09 | $3–4 COGS | ~30% — acceptable outlier; per-account AI soft caps keep the tail bounded |

Blended margin stays **>60% overall** with the AI cost caps from doc 04 enforcing **≥80% on the AI cost line specifically**. The margin dashboard (COGS per game, per plan) is a launch requirement, not an afterthought — alarms fire if per-game COGS drifts above budget.

## Entitlement rules

- **Only the host needs a paid plan.** Invited teams, judges, and spectators need only the free account. This is the core friction-reducer: one buyer per party.
- Entitlements are enforced **server-side** on every gated action (game creation config, AI judging, geofencing, team count) — the client merely reflects state.
- Tier 2 game credits are consumed at game **start** (not creation), refunded automatically if a game is abandoned in lobby.

## Free tier & ads

- Free tier is a real, complete game (2 teams, fixed config) — it's the demo and the viral loop. Ads are minimal (lobby + results banners, family-safe categories only) so the free experience stays inviting.
- Estimated ad revenue is treated as $0 in margin planning — upside, not a pillar.
