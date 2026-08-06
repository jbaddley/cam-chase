/**
 * Android App Links statement, served at `/.well-known/assetlinks.json`.
 *
 * It is what lets Android open `photochase.app/j/<code>` straight into the app
 * (with `autoVerify`, no chooser). It ties the domain to the app's package and
 * its signing certificate(s): the SHA-256 fingerprints of the debug key, the
 * upload key, and — once on Play — the Play App Signing key.
 *
 * The fingerprints are deployment config supplied via
 * `ANDROID_SHA256_CERT_FINGERPRINTS` (comma-separated) on the web host. Get one
 * with `keytool -list -v -keystore <keystore> -alias <alias>`, or from the Play
 * Console (App integrity). Until set this serves a placeholder that will not
 * verify — correct, since no signed app claims the domain yet.
 */

// Baked at build time from the host's `ANDROID_SHA256_CERT_FINGERPRINTS`.
// Amplify Hosting injects app environment variables into the build but NOT into
// the Next.js SSR runtime, so a `force-dynamic` read runs in the runtime, sees
// no env, and serves the placeholder. `force-static` runs GET at build instead,
// where the env value is present. Changing the fingerprints therefore takes a
// redeploy — which is the only way the value reaches this app anyway.
export const dynamic = 'force-static';

const PLACEHOLDER_FINGERPRINT = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

export function GET(): Response {
  const fingerprints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS ?? PLACEHOLDER_FINGERPRINT)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const body = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'app.photochase.client',
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}
