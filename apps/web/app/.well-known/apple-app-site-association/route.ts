/**
 * Apple App Site Association, served at
 * `/.well-known/apple-app-site-association` (no extension, application/json).
 *
 * It is what lets iOS open `photochase.app/j/<code>` straight into the app
 * instead of Safari. The `appID` is `<AppleTeamID>.<bundleID>`; the bundle id is
 * fixed (app.photochase.client), the team id is deployment config supplied via
 * `APPLE_APP_ID` on the web host. Until that is set this serves a placeholder
 * that will not verify — which is correct, because there is no signed app to
 * associate with the domain yet.
 */

// Baked at build time from the host's `APPLE_APP_ID`. Amplify Hosting injects
// app environment variables into the build but NOT into the Next.js SSR runtime,
// so a `force-dynamic` read runs in the runtime, sees no env, and serves the
// placeholder. `force-static` runs GET at build instead, where the env value is
// present. Changing the App ID therefore takes a redeploy — which is the only
// way the value reaches this app anyway.
export const dynamic = 'force-static';

const PLACEHOLDER_APP_ID = 'TEAMID.app.photochase.client';

export function GET(): Response {
  const appID = process.env.APPLE_APP_ID ?? PLACEHOLDER_APP_ID;
  const body = {
    applinks: {
      details: [
        {
          appIDs: [appID],
          // Only the join links; everything else stays in the browser.
          components: [{ '/': '/j/*', comment: 'Join a game' }],
        },
      ],
    },
  };
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}
