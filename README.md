# PhotoChase

**PhotoChase** is a multi-team, location-based photo chase game. Teams head out into a defined play area, take photos containing a location clue and a face (the crazier the pose, the better), then chase each other's photos — hunting down the original spot and recreating the location, angle, and pose. Everyone rates the results, points are awarded, and a winner is crowned.

Primary platform: **mobile (iOS / Android)**. Secondary: **web** (join, spectate, big-screen comparison viewing, marketing).

## Documentation index

| Doc | Contents |
|-----|----------|
| [01 – Product Spec](docs/01-product-spec.md) | Game rules, roles, lifecycle, configuration, casting/big-screen |
| [02 – Architecture](docs/02-architecture.md) | App stack, AWS services, data model, realtime, payments, ads |
| [03 – Pricing & Monetization](docs/03-pricing-monetization.md) | Tiers, store economics, margin model, deals |
| [04 – AI Strategy](docs/04-ai-strategy.md) | AI judging, providers, cost controls, paid-tier feature ideas |
| [05 – Testing Strategy](docs/05-testing-strategy.md) | Full test pyramid, game simulation harness, CI/CD |
| [06 – i18n & Markets](docs/06-i18n-markets.md) | Languages, market priorities, international law |
| [07 – Privacy & Security](docs/07-privacy-security.md) | Data handling, faces & GPS, policy page outlines |
| [08 – Growth & Referrals](docs/08-growth-referrals.md) | Referral codes, share incentives, social posting |
| [09 – Roadmap](docs/09-roadmap.md) | Phased delivery plan with exit criteria |

## Codebase

A pnpm + Turborepo monorepo. The entire game ruleset lives as dependency-free
TypeScript in `packages/shared` and is exhaustively tested.

```
packages/shared   Pure-TS game engine: state machine, Round 2 assignment,
                  scoring, geofencing, finals/decoy scoring, entitlements,
                  pricing/margin model, AI judging & recap, referrals,
                  share cards, tournament standings, full-game simulation.
packages/i18n     Message catalogs (en, es, fr, de, pt, ja) with enforced key parity.
services/api      Handlers over the engine behind repository ports (in-memory
                  now; DynamoDB later): games, entitlements, billing webhooks,
                  AI/referrals/share, tournaments/recap.
apps/web          Next.js marketing + big-screen spectator scaffold.
apps/mobile       Expo (React Native) scaffold (Join + Lobby screens).
infra/cdk         AWS CDK stack (DynamoDB, S3, Cognito, HTTP API + Lambda).
```

### Develop

```bash
pnpm install
pnpm test        # ~150 unit/property/simulation tests
pnpm typecheck
pnpm lint
```

CI (`.github/workflows/ci.yml`) runs install, lint, typecheck, and tests on
every push and PR.

### Delivery status

Built across four phase branches (each merged to `main`), tracked as GitHub
epics with PRD-style sub-issues:

- **Phase 1 — Foundation & MVP engine** (#1): monorepo, game engine, full-game
  simulation, API skeleton, CDK, app scaffolds, CI.
- **Phase 2 — Monetization & configuration** (#10): entitlements, pricing/margin
  model, geofencing & return-time scoring, finals tallying, es/fr/de.
- **Phase 3 — AI judging & growth** (#17): AI judging (budget cap, kill switch),
  referrals, share-card consent gate, pt-BR.
- **Phase 4 — Depth & expansion** (#23): tournament standings, Decoy game type,
  AI recap, Japanese.

External integrations that can't run headless (live StoreKit/Play/Stripe/AdMob,
LLM/Rekognition calls, Cast SDKs, AWS deploys) are implemented as tested pure
logic behind provider/repository seams, ready to wire to real services.

## Decision log

| Decision | Choice | Why |
|----------|--------|-----|
| App framework | React Native + Expo (TypeScript) | One codebase for iOS/Android/web, OTA updates via EAS, strong camera/GPS ecosystem |
| Backend | Serverless-first on AWS | Near-zero idle cost (margin targets), burst-scales on game days, aligns with existing AWS footprint |
| IaC | AWS CDK (TypeScript) | Same language as app/backend; dev/staging/prod accounts via AWS Organizations |
| Payments | RevenueCat (StoreKit 2 + Play Billing) + Stripe on web | Single entitlement system, handles intro offers and receipts |
| Auth | Cognito federating Google, Facebook, X, **and Apple** | Sign in with Apple is mandatory on iOS when other social logins are offered |
| AI judging | Claude vision models + Amazon Rekognition pre-checks | Cheap face detection first, LLM only for pairwise judging; capped per game |
| Casting | Web big-screen view first; native Cast/AirPlay SDKs later | Works on any TV browser day one, far less platform code |
