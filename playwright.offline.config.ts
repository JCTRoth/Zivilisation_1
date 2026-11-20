import { defineConfig, devices } from '@playwright/test';

/**
 * The offline / PWA end-to-end suite.
 *
 * It runs against the *production build* served by `scripts/static-server.mjs`
 * — a service worker only exists in a built app, and the dev server must
 * stay untouched (see `packages/web/pwa/vite-plugin-pwa.mjs`).
 *
 *   npm run test:offline
 */
const PORT = Number(process.env.CIV1_OFFLINE_PORT ?? 4173);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /offline\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  maxFailures: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    {
      name: 'offline',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run build && node scripts/static-server.mjs --root dist --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
