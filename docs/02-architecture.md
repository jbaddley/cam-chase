# 02 – Architecture

## Client stack

- **Framework:** React Native + **Expo** (TypeScript). One codebase targets iOS, Android, and web.
- **Navigation:** Expo Router (file-based, deep-link friendly — critical for QR/join/referral links).
- **Web:** Expo web output for the game surfaces (join, lobby, spectator/big-screen, results). Marketing page as a static Next.js site (SEO, OG share cards) sharing the design system.
- **Design system:** Tamagui (or NativeWind) — themable tokens, works native + web, supports the playful look (spring animations via Reanimated, confetti via Skia/Lottie).
- **Device APIs:** `expo-camera` (capture), `expo-location` + `expo-task-manager` (GPS, geofencing), `expo-av`/Skia for reveal animations.
- **OTA updates:** EAS Update for JS-level fixes without store review; EAS Build/Submit for binaries.

## Monorepo layout (when scaffolding begins)

```
photochase/
├── apps/
│   ├── mobile/          # Expo app (iOS/Android + game web surfaces)
│   └── web/             # Next.js marketing site + OG card rendering
├── services/
│   └── api/             # Lambda handlers, state machine, judging pipeline
├── packages/
│   ├── shared/          # PURE TypeScript game engine: state machine, scoring,
│   │                    # assignment algorithms, config validation, zod schemas
│   └── ui/              # Shared design-system components
├── infra/
│   └── cdk/             # AWS CDK (TypeScript) stacks: dev / staging / prod
└── tooling: pnpm workspaces + Turborepo
```

`packages/shared` is deliberately dependency-free and platform-free: the entire game ruleset lives here and is exhaustively unit-tested (see doc 05). Client and server both import it, so scoring can be previewed client-side and enforced server-side from the same code.

## AWS backend (serverless-first)

| Concern | Service | Notes |
|---------|---------|-------|
| Auth | **Cognito user pool** federating Google, Facebook (Meta), X (OIDC), **Sign in with Apple** | Apple sign-in is mandatory on iOS when other social logins are present. Account linking below |
| API | API Gateway (HTTP API) + **Lambda** (Node 20, TypeScript) | Thin handlers over `packages/shared` engine |
| Realtime | **AppSync Events** (or API Gateway WebSockets) | Lobby membership, timers, state transitions, live vote tallies, big-screen sync |
| Data | **DynamoDB** single-table | Entities: User, Game, Team, Membership, Photo, Assignment, Vote, Score, Referral, Entitlement. On-demand billing (zero idle cost) |
| Photos | **S3** + CloudFront | Presigned, scoped uploads; Lambda thumbnailer (multiple sizes incl. AI-judging size ≤1024px); lifecycle rules per retention policy |
| Async work | SQS + Lambda | AI judging pipeline, share-card rendering, notification fan-out |
| Timers/transitions | EventBridge Scheduler | Round timers fire state transitions server-side (never trust client clocks) |
| Push | SNS → FCM/APNs (via Expo Push) | "Round 2 started", "You're up for voting" |
| Web hosting | CloudFront + S3 (marketing static export); Amplify Hosting acceptable alternative | |
| Observability | CloudWatch + X-Ray; **Sentry** on clients | Alarms on judging-queue depth, websocket errors, p95 latency |
| IaC | **AWS CDK (TypeScript)** | One stack set per env; dev/staging/prod in separate accounts under AWS Organizations; CI runs `cdk diff` gates |

### Why serverless

Game traffic is extremely bursty (weekend afternoons, event evenings) with long idle periods. Lambda + DynamoDB on-demand + S3 means COGS track usage almost linearly — which is what makes the ≥60% overall / ≥80% AI margin targets in doc 03 hold without capacity planning.

## Identity and account linking

Requirement: a user can connect Google, Facebook, and X (and Apple) to **one** PhotoChase account and log in with any of them.

- Cognito federates all four IdPs; our own `User` record is the canonical identity.
- **Linking rule:** on first federated login, if the IdP-asserted **verified** email matches an existing user's verified email, link automatically; otherwise create a new account. Unverified emails never auto-link (account-takeover vector) — instead prompt: "Is this you? Sign in with your original provider to link."
- Settings screen lets users view/link/unlink providers; at least one provider (or a set password) must always remain.
- Apple's private relay emails are treated as distinct; manual linking flow covers them.

## Payments

- **RevenueCat** as the entitlement layer over StoreKit 2 (iOS) and Google Play Billing (Android). Handles receipts, restore purchases, intro offers ($9.99 first 3 months → $5.99), price experiments, and cross-platform entitlement sync tied to the PhotoChase user ID.
- **Stripe** for web purchases (allowed for web-originated checkout; ~97% net vs 70–85% through stores). The marketing site promotes web checkout where policy allows.
- Server-side entitlement checks gate every tiered feature (never client-only). Webhooks from RevenueCat/Stripe update the `Entitlement` record in DynamoDB.
- Apple requires in-app purchase for digital goods bought inside the iOS app — the app never links out to external payment from within iOS except where regionally permitted (US anti-steering entitlement, EU DMA); this stays behind a remote-config flag per storefront.

## Ads (free tier)

- **AdMob**, banner + occasional native card, in **lobby and results screens only**. Never during capture, rounds, rating, or reveals. Content rating capped at family-appropriate categories. Any paid entitlement removes ads entirely. ATT prompt on iOS handled with a pre-permission explainer; non-personalized ads fallback when declined (also the GDPR default).

## Social sharing

- OS share sheet everywhere (covers Instagram, X, Facebook, Messages, WhatsApp…).
- Server-rendered **OG share cards**: a Lambda renders side-by-side comparison images with game branding so links shared to X/Facebook unfurl beautifully; Instagram gets a pre-composed image via the share sheet.
- Sharing always goes through a consent gate ("everyone in this photo OK with sharing?") per doc 07.

## Casting

- v1: web big-screen view (`/watch` + game code) — works with Chromecast tab casting, AirPlay mirroring, and any smart-TV browser with zero native code.
- Fast follow: Google Cast SDK (custom receiver rendering the same web view) and native AirPlay from the mobile app.

## Key data-model notes (DynamoDB single table)

- `GAME#<id>` partition holds game, teams, memberships, photos, assignments, votes — one-partition reads for the hot path (a game in progress), no cross-partition transactions during play.
- Photos store: S3 key, capture GPS + accuracy + heading, capture timestamp, shooter member ID, foul flags, AI scores.
- Assignments store: game type ordering, delivery order, submitted chase photo ID — the Round 2 queue per team is a simple sorted query.
- Votes are idempotent per (voter, pair, axis) — last write wins; tallies computed by the engine, cached on the game record for the big screen.
- All IDs are unguessable (ULIDs); join codes map to game IDs via a short-lived lookup item with rate limiting (see doc 07).
