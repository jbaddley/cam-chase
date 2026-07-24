# 09 – Roadmap

Each phase lists exit criteria, including which test layers (doc 05) must be green. Phases are sequential but overlap is expected (e.g., i18n tooling lands in Phase 0 even though languages ship in Phase 2).

## Phase 0 — Foundation (≈ 4–6 weeks)

- Monorepo scaffold (pnpm + Turborepo): `apps/mobile`, `apps/web`, `services/api`, `packages/shared`, `packages/ui`, `infra/cdk`.
- CDK stacks + dev/staging/prod accounts; CI/CD pipeline (PR fast lane + integration lane) live from the first commit.
- Cognito auth with all four IdPs + verified-email account linking; design system with the playful theme; i18n scaffolding + pseudo-locale build.
- **Exit:** unit + component + LocalStack integration lanes green in CI; a signed-in user exists on device and web; `cdk deploy` reproducible in all three accounts.

## Phase 1 — MVP: the free game (≈ 8–10 weeks)

- Full game loop, free-tier rules: create game → code/QR join → teams lobby (realtime) → Round 1 capture (camera, photo count, timer) → return check-in → Round 2 assignments (Round Robin) → rating → finals best-match vote → results with score breakdown.
- Basic GPS scoring (coarse bands), manual foul flagging, web spectator/big-screen view, EN only.
- Photo pipeline: presigned uploads, thumbnails, retention lifecycle. Privacy Policy + Security pages live (store review requires them).
- **Exit:** bot simulation harness completes full games with expected scoreboards on every PR; Maestro happy-path on both platforms; Playwright web suite; k6 baseline; internal TestFlight/Play-track dogfood games played by real humans.

## Phase 2 — Monetization & configuration (≈ 6–8 weeks)

- Tiers + RevenueCat (Tier 2 credits, Tier 3 subscription, intro offer), Stripe web checkout, server-side entitlements; AdMob on free tier.
- Full config matrix (photos/minutes ranges, 6 teams, Random mode, special categories incl. saved custom ones, judge weights); judges/spectators as first-class roles; geofencing + return-time bonuses.
- Localization: ES, FR, DE shipped app + store listings; regional pricing.
- **Exit:** purchase/restore/cancel sandbox suites green; entitlement truth-table tests green; simulation matrix covers all tiers/configs; localized E2E smoke passes; margin dashboard live with per-game COGS.

## Phase 3 — AI & growth (≈ 6–8 weeks)

- AI judging pipeline (face pre-checks, pairwise judging, budget caps, kill switch) with golden-set eval gate; AI scores in rating UI.
- Referral program with deferred-deep-link attribution; share cards + consent gate; post-game shareable-moments screen; marketing site launch.
- Native casting SDKs (Google Cast, AirPlay); annual SKU + lifetime launch promo; PT-BR localization.
- **Exit:** AI eval correlation ≥ threshold and cost-per-game under cap in nightly live run; referral attribution E2E verified through real store sandbox installs; share cards render localized.

## Phase 4 — Depth & expansion (ongoing)

- Tournament/league mode, corporate/event SKU, additional game types (Relay, Decoy, Blitz, Theme), AI highlight reels & game recaps, route heatmaps, album export.
- Japanese localization + JP market entry; Korean next per doc 06.
- Community features: public game templates, club profiles, seasonal events.
- **Exit criteria per feature:** each ships with its simulation-matrix entry, eval/cost gates where AI is involved, and localized strings — no feature merges without its tests (doc 05 flake policy applies).

## Standing tracks (all phases)

- **Margin watch:** COGS dashboard + alarms (docs 03/04) reviewed weekly.
- **Trust:** DSR SLA monitoring, moderation queue review, store data-label sync on every data-model change.
- **Quality:** flake quarantine ≤ 2 weeks, crash-free sessions ≥ 99.5% gate on releases.
