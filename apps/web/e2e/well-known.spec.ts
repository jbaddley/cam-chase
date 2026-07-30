import { expect, test } from '@playwright/test';

/**
 * The app-link association files that let photochase.app/j/<code> open the app.
 * Their app-specific values (Apple team id, Android cert fingerprints) come from
 * host env, so these check the shape and content type, not the placeholders.
 */
test.describe('app-link association files', () => {
  test('serves the Apple App Site Association as JSON scoped to /j/*', async ({ request }) => {
    const res = await request.get('/.well-known/apple-app-site-association');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');

    const body = await res.json();
    const detail = body.applinks.details[0];
    expect(detail.appIDs[0]).toMatch(/\.app\.photochase\.client$/);
    expect(detail.components[0]['/']).toBe('/j/*');
  });

  test('serves the Android asset links as JSON for the package', async ({ request }) => {
    const res = await request.get('/.well-known/assetlinks.json');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');

    const body = await res.json();
    expect(body[0].relation).toContain('delegate_permission/common.handle_all_urls');
    expect(body[0].target.package_name).toBe('app.photochase.client');
    expect(Array.isArray(body[0].target.sha256_cert_fingerprints)).toBe(true);
  });
});
