# @photochase/mobile

The Expo (React Native) app. Real camera, real GPS, real sign-in sheet, real
store — all behind injected boundaries so the screens stay testable without a
native build.

## Layout

| Path | What it is |
| --- | --- |
| `index.ts` | Expo entry point; registers `src/root.tsx` |
| `src/root.tsx` | The **only** file that knows about native modules |
| `App.tsx` | Route state outside a game; takes its boundaries as props |
| `src/GameRouter.tsx` | Picks the screen from the polled phase **and** the game's mode |
| `src/screens/` | Every screen; none import a native module |
| `src/native/` | The real camera, auth and store implementations |
| `test/react-native-shim.tsx` | DOM stand-ins for RN primitives, used under Vitest |

The three seams — `Authorizer`, `PurchaseGateway`, `CaptureSource` — are
arguments, not imports. That is what lets `pnpm test` render every screen in
jsdom and drive its real logic. `src/root.tsx` supplies the native versions;
`App.tsx`'s defaults throw or return a fixture rather than pretending to sign
someone in, sell them something, or take a photograph.

## Running the tests

```bash
pnpm test        # 200+ component tests in jsdom, no device needed
pnpm typecheck
pnpm lint
```

Under Vitest, `react-native` is aliased to `test/react-native-shim.tsx`. Drive
components with Testing Library's `fireEvent` — a raw `.click()` does not flush
React state and yields tests that pass vacuously.

## Running on a device

Expo Go is **not** enough: this app needs the camera, location, the native auth
sheet and the store, so it needs a development build.

### 1. Point it at a deployed API

`eas.json` already points at the deployed **dev** stack, so a development build
works as-is. For a new environment, deploy it (`infra/cdk`, `npx cdk deploy
PhotoChase-<env> -c <env>:account=<id>`) and copy the `ApiUrl` and
`UserPoolClientId` outputs into that profile's `env` block.

The Cognito app client is created with `photochase://auth` already registered as
a callback URL, which matches `REDIRECT_URI` in `src/auth.ts`. Change one and
you must change the other.

**Sign in with email**, not one of the social buttons, unless the stack was
deployed with `-c <env>:idpSecret=…`. Without that secret the user pool supports
`COGNITO` alone, so Apple/Google/Facebook/X will all fail — the email option
lands on Cognito's own hosted sign-up page and works on any stack.

### 2. Build

```bash
npx eas login
npx eas build:configure          # first time only; writes the EAS project id
npx eas build --profile development --platform android   # or ios
```

Install the resulting APK (or the iOS build, via TestFlight/ad-hoc), then:

```bash
pnpm start --dev-client
```

An iOS device build needs an Apple Developer account. Android does not, which
makes it the cheaper first target.

### 3. Verify the bundle without a device

This catches most breakage in a minute, offline:

```bash
npx expo export --platform android --output-dir /tmp/photochase-export
```

It resolves every module, transforms it, and compiles to Hermes bytecode — the
same steps EAS runs. A version skew between `expo` and `react-native` shows up
here as a Hermes compile error rather than as a mysterious crash on device.

### What still cannot be verified offline

- **Photo Tag's proximity warning, scatter timing and catch latency.** Consumer
  GPS is ±5–10 m and the app polls at 3 s. This is the one mechanic that can
  only be judged by playing it (docs/01).
- **Purchases.** They need products configured in App Store Connect and Play
  Console and a RevenueCat project. Without `EXPO_PUBLIC_REVENUECAT_KEY` the app
  runs normally and the plan screen simply offers nothing to buy.
- **The non-English strings.** ES/FR/DE/PT/JA are machine-quality and unreviewed.

## Environment

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | API base URL (CDK output `ApiUrl`) |
| `EXPO_PUBLIC_AUTH_DOMAIN` | Cognito domain serving `/oauth2/*` |
| `EXPO_PUBLIC_USER_POOL_CLIENT_ID` | User pool app client id (CDK output) |
| `EXPO_PUBLIC_REVENUECAT_KEY` | RevenueCat public SDK key; omit to disable purchases |

Everything prefixed `EXPO_PUBLIC_` is embedded in the bundle and readable by
anyone with the app. That is fine for all four — none is a secret. The purchase
webhook secret is a server-side value and lives in `infra/cdk`; it must never
appear here.

## How the native boundaries work

### Camera and location — `src/native/CameraStage.tsx`, `src/native/capture.ts`

`CameraStage` owns the camera for the whole app and hands the screens a
`CaptureSource`. The preview runs only while a shooting screen asks for it
through `src/viewfinder.ts`, so the app does not hold the camera open — or
prompt for it — on the sign-in screen.

`makeCapture` reads the GPS fix *after* the shutter, so the coordinates belong
to where the photo was actually taken. If location is denied it throws rather
than submitting a photo that would silently score zero for accuracy.

### Sign-in — `src/native/auth.ts`

`nativeAuthorizer` opens the OS auth sheet (`ASWebAuthenticationSession` on iOS,
Chrome Custom Tabs on Android). React Native has no `crypto.subtle`, so
`src/root.tsx` swaps the PKCE crypto source for an expo-crypto one before any
screen can start a sign-in.

### Purchases — `src/native/purchases.ts`

RevenueCat, configured with **our** user id: it forwards that id to the server's
purchase webhook as `app_user_id`, and the webhook is the only thing that can
change an entitlement. Configure it anonymously and a completed purchase would
credit nobody. The app grants nothing locally; after a purchase it re-reads
`GET /me/entitlement`, so a client that lies about a purchase gains nothing.
