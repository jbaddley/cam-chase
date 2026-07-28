# PhotoChase

A multi-team, location-based photo chase game. pnpm workspaces + Turborepo.

```
packages/shared    pure-TS game engine — state machine, scoring, RNG, geofence
packages/client    typed API client
packages/i18n      message catalogue (6 locales)
apps/mobile        Expo / React Native app
apps/web           Next.js marketing + spectator view
services/api       Lambda handlers + router
infra/cdk          AWS CDK stack
```

## Commands

```bash
pnpm -r typecheck && pnpm lint && pnpm -r test   # the full gate
pnpm --filter @photochase/shared test            # one package
cd apps/mobile && pnpm start --dev-client        # Metro for the dev build
cd infra/cdk && pnpm cdk deploy PhotoChase-dev   # deploy (needs AWS creds)
```

## Conventions that are load-bearing

**Bite-checking.** Every new gate must be verified by breaking the rule it
guards and confirming a test fails. A test that passes whether or not the code
is right is worse than no test — this project has shipped that mistake before.

**Mobile tests** run under Vitest + jsdom with `react-native` aliased to
`apps/mobile/test/react-native-shim.tsx`. Two hard rules:
- Drive interactions with `fireEvent`. A raw `.click()` does not flush React
  state and yields tests that pass vacuously.
- The include pattern is `src/**/*.test.tsx`. A test file at the app root is
  silently never run.

**Injected boundaries.** Screens never import native modules. Camera, auth and
purchases arrive as `CaptureSource`, `Authorizer` and `PurchaseGateway` props.
This is what makes the screens testable in jsdom at all — don't route around it.

**Every mode emits the same `TeamScore`.** Results, spectator view and
tournament standings are mode-agnostic; only the *labels* differ per mode. When
adding a mode, add a scorer that returns `TeamScore` rather than a new shape.

**The server is the only authority on entitlements.** The client may show a
locked state; it may never grant one.

## Gotchas that have each cost an afternoon

**`EXPO_PUBLIC_*` are inlined at bundle time.** The dev client loads JS from
local Metro, which reads `apps/mobile/.env` — it never reads `eas.json`. A
missing `.env` produces a Cognito "Invalid client id" that looks like an auth
bug. `src/config.ts` fails loudly with instructions rather than falling back to
a placeholder; keep it that way.

**Android edge-to-edge does not resize the window for the keyboard.** With
`edgeToEdgeEnabled: true`, `KeyboardAvoidingView` is inert on Android. Measure
the keyboard directly — see `src/useKeyboardInset.ts`. A layout fix that appears
to work on Android is usually being masked by keyboard-dismiss behaviour; a
static render test can never validate this.

**Deploy drift is the recurring bug.** Server code has repeatedly been correct
in the repo and stale in the deployed Lambda — the ABANDON event was "not
implemented" in production for hours while its tests were green. Before blaming
handler code for a device-test failure, check that the deploy is newer than the
last commit touching `services/api`, `packages/shared`, or `infra/cdk`.

**Built-but-unrouted is the other one.** Tournaments, growth/referrals, the
recap generator, six mode screens and `/spectate/:code` were each complete,
tested and unreachable. A passing test suite says nothing about whether a
route exists. `services/api/src/public-routes.ts` is the single source of truth
for which routes bypass the JWT authorizer — the CDK stack reads it, so adding a
public route in one place only is not possible by construction.

**Two `@types/react` copies exist in the monorepo.** `apps/web/tsconfig.json`
pins them via `paths`. Removing that reintroduces TS2742.

## Deployed dev stack (us-east-1)

```
API            https://yragu7zl51.execute-api.us-east-1.amazonaws.com
Auth domain    https://photochase-dev.auth.us-east-1.amazoncognito.com
User pool      us-east-1_gqUI8iKzW
Client id      4dplbp0cg2t06nf272ur32u2od
```

These four values are public by design — they ship inside every copy of the app.
Secrets (the purchase webhook secret, IdP credentials) are server-side only and
must never appear in `.env`, `eas.json`, or this file.

Cognito is deployed COGNITO-only: email sign-in works, the social IdP buttons do
not, because the pool has no IdPs configured.

## Workflow

Phases are branches; each issue is one commit; phases merge to `main`. GitHub
issues track phases as large tickets with PRD-style sub-issues, closed as they
land. The mode/retention plan lives in `docs/09-roadmap.md` and the phase
breakdown A–F.
