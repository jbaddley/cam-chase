# 05 – Testing Strategy

The question that started this repo: **how can we test this?** A location-based, camera-driven, multi-device, realtime game is hard to test naively — so the architecture is shaped for testability first, and this doc is the contract for it.

## Principles

1. **The game engine is pure TypeScript** (`packages/shared`): state machine, scoring, assignment, config validation — no I/O, no platform APIs. The hardest logic is therefore the easiest to test.
2. **Hardware is injected, never assumed.** Camera, GPS, clock, and randomness sit behind interfaces with test doubles: fixture images, scripted location tracks, virtual clocks, seeded RNG.
3. **A full game must be playable by robots.** The multi-client simulation harness (below) is the flagship test — if bots can't finish a game through the real API, humans can't either.
4. **Server is the referee.** Timers, entitlements, and scoring are enforced server-side, so tests against the API are tests of the real rules.

## The pyramid

### 1. Unit tests — `packages/shared` (Vitest)

- **State machine:** every legal transition, every illegal transition rejected (e.g., can't start with 1 team; can't rate before `round2_return`; host-force-advance paths).
- **Scoring:** GPS banding math, vote tallies with judge multipliers (1x–5x), foul penalties, time bonuses, best-overall and special categories, tie-breaking.
- **Assignment algorithms:** round robin ring order and original photo order preserved; random mode invariants.
- **Property-based tests (fast-check):** for all team counts 2–6 and photo counts 5–20: no team ever receives its own photo; every photo chased exactly once; scores are permutation-stable; seeded random assignment is reproducible.
- **Config validation:** ranges (photos 5–20, minutes 5–20), tier gating truth table (feature × tier), custom category limits (≤5, persisted per profile).
- Target: ~95% coverage on `packages/shared` — this package is cheap to cover and is the game.

### 2. Component tests — React Native Testing Library + Storybook

- Screen-level: lobby renders team joins from a mocked realtime stream; capture screen enforces photo count/timer display; rating flow blocks self-rating; big-screen layout switches by viewport.
- Storybook (native + web) for design-system components; Chromatic (or Storybook test-runner snapshots) for visual regression on the playful UI.

### 3. API & integration tests — Lambda handlers vs. local AWS

- Handlers run in-process against **DynamoDB Local / LocalStack** (S3, SQS, EventBridge) in CI — full CRUD + state transitions + entitlement gates without deploying.
- **Contract tests:** zod schemas in `packages/shared` are the single source for request/response types; client and server both validate against them, so drift fails the build, not production.
- Auth: Cognito-issued JWT verification with test keys; per-role authorization matrix (host vs. member vs. judge vs. spectator) exercised endpoint by endpoint.

### 4. Multi-client game simulation harness — the keystone

A bot orchestrator (`packages/shared` consumer + API client) that plays **entire games** against a real deployed stack (ephemeral per-PR env or staging):

- Spins up N bot users → host creates game (each tier/config permutation from a matrix) → bots join via the join-code API path, form teams, add judges/spectators.
- Round 1: bots "take photos" by uploading **fixture images with controlled EXIF/GPS** via the real presigned-upload flow; some intentionally omit faces/clues to exercise fouls.
- Return check-ins with scripted GPS tracks (including geofence enter/exit for paid configs).
- Round 2: bots fetch assignments, submit chase photos at controlled GPS offsets (10 m / 40 m / 200 m) so expected location scores are known in advance.
- Rating & finals: bots vote per script (including judge-weighted votes); AI judging runs in **stub mode** (deterministic scores) except in a nightly live-AI variant.
- **Assertion: the final scoreboard equals the independently computed expected scoreboard** (same seeds, same engine, computed offline). Any drift = red build.
- Runs: smoke variant (2 teams, minimal config) on every PR; full matrix (2–6 teams × game types × tiers) nightly. Also doubles as the load-test scenario generator.

### 5. E2E — real app, real screens

- **Mobile: Maestro** (chosen over Detox: simpler flows-as-YAML, first-class Expo/EAS support, cloud device runs). Critical flows: sign-in (all four IdPs via test accounts), create game, QR/code join, camera capture (using injected mock camera images), full happy-path game between two simulator instances, purchase flow against sandbox.
- **Web: Playwright** — join via code, lobby live-updates, spectator big-screen view (assert layout at TV/tablet/phone viewports), marketing page, results.
- Device matrix on EAS/Maestro cloud: oldest-supported iOS + Android, small/large screens, offline-mode entry.

### 6. Hardware & platform mocking

- **Camera:** capture layer accepts an injected image source; E2E builds bundle fixture photos (with faces/clues staged) so tests are deterministic and CI needs no camera.
- **GPS:** location provider interface driven by scripted tracks (walk paths, geofence crossings, poor-accuracy jitter); simulator location injection for E2E.
- **Clock:** all timing via a server-authoritative virtual clock in tests — round expiry tested in milliseconds, not minutes.
- **Casting:** the big-screen is a web view, so Playwright covers it; native Cast SDK gets a thin manual checklist per release.

### 7. Payments & entitlements

- Unit: entitlement gate truth table (every gated feature × every tier × credit states).
- Integration: RevenueCat sandbox + Apple sandbox testers + Play internal test track — purchase, restore, cancel, intro-offer ($9.99→$5.99) transition, Tier 2 credit consumption/refund-on-abandon.
- Webhook handlers tested with recorded RevenueCat/Stripe payloads (replay suite).

### 8. AI judging quality (see doc 04)

- Golden-set eval (~200 human-scored pairs) runs as a CI job on any prompt/model change; ships only above the human-correlation threshold. Cost-per-game assertion runs alongside (fails if projected COGS breaches the cap).

### 9. Non-functional

- **Load (k6):** game-day burst — 6 teams × 8 members uploading photos simultaneously; 500 concurrent games; websocket fan-out on reveal. Budgets: p95 upload-init < 400 ms, state-transition fan-out < 1 s.
- **Chaos/network:** uploads on airplane-mode toggles, retry/resume, double-submit idempotency; websocket reconnect with state catch-up.
- **Security:** presigned-URL scoping (can't read another game's photos), IDOR probes on ULIDs, join-code brute-force rate limiting, dependency audit + secret scanning in CI (see doc 07).
- **i18n:** pseudo-localization build (lengthened strings, accented chars) run through the E2E smoke to catch truncation/layout breaks; snapshot tests per locale for critical screens.
- **Accessibility:** automated axe checks on web; RN accessibility-label lint; manual screen-reader pass per release.

## CI/CD (GitHub Actions)

| Stage | When | Contents |
|-------|------|----------|
| PR fast lane | every push | lint, typecheck, unit (shared + services), component tests, contract check — < 10 min |
| PR integration | every PR | LocalStack API suite, CDK synth + `cdk diff` gate, smoke simulation vs. ephemeral env |
| Nightly | scheduled | full simulation matrix, Maestro cloud device runs, Playwright full suite, k6 baseline, live-AI eval + cost check |
| Release | tag | EAS Build (iOS/Android) + Submit to TestFlight/internal track, web deploy to staging → prod via CDK pipeline, store-sandbox purchase suite |

Flake policy: quarantine tag with auto-filed issue; a quarantined test older than 2 weeks blocks release. Every bug fix lands with a regression test at the lowest layer that can express it.
