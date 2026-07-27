import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import type { CryptoSource } from '@photochase/client';
import type { Authorizer } from '../auth.js';

/**
 * The real sign-in boundary: a system browser sheet, and platform crypto.
 *
 * Kept out of `src/auth.ts` so that module — and every screen that imports it —
 * stays loadable without a native runtime.
 */

/**
 * Open the provider's page in the OS-managed auth sheet
 * (ASWebAuthenticationSession on iOS, Chrome Custom Tabs on Android) and
 * resolve with the URL it returns to.
 *
 * The sheet is used rather than an in-app WebView because it is the only way a
 * public OAuth client is accepted: the page is visibly the provider's own, and
 * the app cannot read what is typed into it.
 *
 * Dismissal resolves with an empty string rather than throwing — `signIn`
 * treats that as {@link SignInCancelled}, which is not an error worth showing.
 */
export const nativeAuthorizer: Authorizer = async (url, redirectUri) => {
  const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
  return result.type === 'success' ? result.url : '';
};

/**
 * PKCE crypto for React Native.
 *
 * Hermes exposes `crypto.getRandomValues` but no `crypto.subtle`, so the
 * default web source in `src/auth.ts` would throw on the SHA-256 step. This
 * supplies both halves from expo-crypto instead.
 */
export const expoCrypto: CryptoSource = {
  randomBytes: (length) => Crypto.getRandomValues(new Uint8Array(length)),
  sha256: async (input) => {
    // The PKCE verifier is base64url, so every character is one ASCII byte and
    // this is exact. Done by hand because `TextEncoder` is not guaranteed to be
    // a global on every React Native runtime, and getting the digest input
    // wrong would fail only at the token exchange, far from the cause.
    const bytes = Uint8Array.from(input, (character) => character.charCodeAt(0));
    return new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  },
};
