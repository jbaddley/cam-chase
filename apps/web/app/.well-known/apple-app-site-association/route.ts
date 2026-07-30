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

// Read live, so the value can be set on the host without a rebuild.
export const dynamic = 'force-dynamic';

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
