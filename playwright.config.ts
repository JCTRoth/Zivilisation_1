import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright end-to-end test configuration.
 *
 * FAIL-FAST STRATEGY (see also .github/copilot-instructions.adoc):
 *   1. `globalSetup` performs a lightweight HTTP connectivity pre-check.
 *      If the application is unreachable it throws, aborting the entire run
 *      before any browser is launched.
 *   2. A dedicated `setup` project (e2e/setup/app-setup.spec.ts) verifies that
 *      the application is running and the core landing page loads. The
 *      `chromium` project declares a dependency on it, so if any setup test
 *      fails, the whole feature suite is skipped.
 *   3. `maxFailures: 1` stops the run after the very first failure anywhere.
 */
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // The K3s suite needs a live cluster (and writes screenshots to the
  // developer's Desktop folder), so it must never run as part of the
  // ordinary suite. It has its own config: `npm run test:k3s`.
  testIgnore: /k3s\/.*\.spec\.ts/,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  // FAIL-FAST: abort the whole run after the first failure.
  maxFailures: 1,
  // Fail the build on CI if a test.only was accidentally committed.
  forbidOnly: isCI,
  // Retry flaky tests on CI only.
  retries: isCI ? 2 : 0,
  // Deterministic, serial execution on CI; parallel locally.
  workers: isCI ? 1 : undefined,
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  // Connectivity pre-check — throws (and aborts everything) if the app is down.
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    // The app follows the browser locale; pin English for stable assertions.
    locale: 'en-US',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // CORE SETUP FIRST: verifies the app is running and the landing page
      // loads. Feature tests only run if this project passes.
      name: 'setup',
      testMatch: /setup\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // All feature tests. Depends on `setup` — a failed setup test skips
      // this entire project (fail-fast).
      name: 'chromium',
      // Mirrors the top-level `testIgnore`: a project-level pattern replaces
      // the config-level one, so the cluster suite has to be excluded here
      // as well.
      testIgnore: [/setup\/.*\.spec\.ts/, /k3s\/.*\.spec\.ts/],
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
