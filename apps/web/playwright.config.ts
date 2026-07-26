import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * A Chromium provided by the environment rather than downloaded by Playwright.
 * Set CHROMIUM_PATH (CI images often ship one at /opt/pw-browsers/chromium) to
 * use it; otherwise Playwright falls back to its own managed browser.
 */
const executablePath = process.env.CHROMIUM_PATH;

/**
 * Web E2E (docs 05, 09). The suite is hermetic: every API call is stubbed with
 * `page.route()`, so it runs offline like the rest of the test strategy — no
 * backend, no AWS.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: {
    // Production build: it is what ships, and it starts faster than dev here.
    command: `pnpm build && pnpm exec next start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
