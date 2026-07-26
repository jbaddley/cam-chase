# @photochase/mobile

Expo (React Native) app — iOS, Android, and web from one codebase.

## Phase 1 status

This is a **scaffold**. The screens under `src/screens` are real and typecheck
against `@photochase/shared`, but the React Native / Expo runtime dependencies
are intentionally not installed in the repo's base workspace to keep CI lean.
Ambient shims in `types/native-shims.d.ts` let it typecheck standalone.

## To turn this into a runnable app

```bash
cd apps/mobile
npx create-expo-app@latest . --template blank-typescript   # or add Expo to this dir
npx expo install expo-router expo-camera expo-location expo-task-manager
npx expo install expo-auth-session expo-crypto expo-web-browser
```

Then delete `types/native-shims.d.ts` (the real package types supersede it) and
wire `App.tsx` into Expo Router. The screens can be dropped in as-is.

## Wiring the injected boundaries

Two seams are deliberately injected so the app typechecks and can be driven
without a native build. Both need real implementations in the Expo app.

### Sign-in (`src/auth.ts`)

`App` takes an `authorize` prop of type `Authorizer`. Supply
`expo-auth-session`'s browser session, which opens
`ASWebAuthenticationSession` on iOS and Chrome Custom Tabs on Android:

```ts
import * as WebBrowser from 'expo-web-browser';

const authorize: Authorizer = async (url, redirectUri) => {
  const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
  return result.type === 'success' ? result.url : '';
};
```

Register `photochase` as the app's scheme in `app.json` so the callback
`photochase://auth` returns to the app; it must match the Cognito callback URL
configured in `infra/cdk`.

`createPkceChallenge` uses Web Crypto. React Native does not ship
`crypto.subtle`, so either install a polyfill or pass a `CryptoSource` backed by
`expo-crypto`'s `digestStringAsync` and `getRandomBytesAsync`.

### Capture (`src/capture.ts`)

`placeholderCapture` returns a fixed blob and location. Replace it with
`expo-camera` for the photo and `expo-location` for the GPS fix.

## Environment

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | API base URL |
| `EXPO_PUBLIC_AUTH_DOMAIN` | Cognito domain serving `/oauth2/*` |
| `EXPO_PUBLIC_USER_POOL_CLIENT_ID` | User pool app client id |

The Cognito stack outputs `UserPoolClientId` and the domain prefix; social
sign-in additionally needs the per-environment IdP secret described in
`infra/cdk`.
