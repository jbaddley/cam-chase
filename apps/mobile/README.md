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
```

Then delete `types/native-shims.d.ts` (the real package types supersede it) and
wire `App.tsx` into Expo Router. The Join and Lobby screens can be dropped in as-is.
