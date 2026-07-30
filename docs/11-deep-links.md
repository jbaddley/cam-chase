# 11 – Deep links & universal links

How a join code gets from a QR or a shared link into the app.

## What works today

- **In-app scan.** Anyone already in the app scans a lobby QR and joins directly
  (the camera boundary, `src/viewfinder.ts` → `CameraStage`).
- **Custom-scheme deep link.** `photochase://j/<code>` opens the app straight
  onto the join flow with the code resolving. The scheme is registered in
  `app.json` (`scheme: "photochase"`), so this needs no domain setup and no
  prebuild beyond what already shipped. Received via React Native's core
  `Linking` in `apps/mobile/src/root.tsx`, parsed by `parseJoinCode`
  (`packages/shared/src/growth/qr.ts`), routed by `App`'s injected `deepLinks`.
- **Web landing.** `photochase.app/j/<code>` (`apps/web/app/j/[code]/page.tsx`)
  confirms the game and shows the code, for a phone camera that opened a browser
  instead of the app.

## What is scaffolded but not yet live: universal / app links

Making `https://photochase.app/j/<code>` open the app **directly** (so a plain
phone camera scanning the web QR skips the browser) needs three things wired to
real values and then deployed. The wiring is in place; the values and the
deploy are not.

### 1. Association files (served by the web app)

- iOS: `/.well-known/apple-app-site-association`
  (`apps/web/app/.well-known/apple-app-site-association/route.ts`)
- Android: `/.well-known/assetlinks.json`
  (`apps/web/app/.well-known/assetlinks.json/route.ts`)

Both read their app-specific values from host env so they can change without a
code change:

| Env var | What | How to get it |
| --- | --- | --- |
| `APPLE_APP_ID` | `<AppleTeamID>.app.photochase.client` | Apple Developer → Membership → Team ID |
| `ANDROID_SHA256_CERT_FINGERPRINTS` | comma-separated SHA-256 fingerprints | `keytool -list -v -keystore <keystore> -alias <alias>`, and the Play Console (App integrity → App signing) once on Play. Include the debug key, the upload key, **and** the Play App Signing key. |

Until they are set, both endpoints serve harmless placeholders that will not
verify — correct, because no signed app claims the domain yet.

### 2. Native config (`apps/mobile/app.json`)

- iOS: `ios.associatedDomains: ["applinks:photochase.app"]`
- Android: `android.intentFilters` — an `autoVerify` `VIEW` filter for
  `https://photochase.app/j`.

Both are already in `app.json`. They take effect only after a **prebuild**
(`npx expo prebuild`) and a fresh build, because they are native manifest /
entitlement changes.

### 3. Hosting

`photochase.app` must actually serve the two `.well-known` files over HTTPS with
`content-type: application/json`. The route handlers do that; the domain has to
point at this web deployment.

## Bring-up checklist

1. Deploy `apps/web` to `photochase.app` with `APPLE_APP_ID` and
   `ANDROID_SHA256_CERT_FINGERPRINTS` set.
2. Confirm both files fetch: `curl https://photochase.app/.well-known/assetlinks.json`.
3. `npx expo prebuild` and rebuild the app (this also picks up the broadened
   camera-usage strings for QR scanning).
4. Verify: Android `adb shell pm verify-app-links --re-verify app.photochase.client`
   then `pm get-app-links app.photochase.client`; iOS, tap a
   `https://photochase.app/j/<code>` link and confirm it opens the app.
5. Add an "Open the app" button to the `/j/<code>` page now that the link
   resolves into the app.
