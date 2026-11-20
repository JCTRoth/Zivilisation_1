import { defineConfig, devices } from '@playwright/test';

/**
 * Dedicated suite that runs against the K3s-deployed stack (NodePorts).
 * Screenshots are written to ~/Desktop/civ1-k3s-screenshots.
 *
 * Start the cluster first (see README), then:
 *   npx playwright test --config playwright.k3s.config.ts
 */
export const SCREENSHOT_DIR = '/home/jonas/Desktop/civ1-k3s-screenshots';

export default defineConfig({
  testDir: './e2e/k3s',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-k3s' }],
  ],
  outputDir: 'test-results/k3s',
  use: {
    baseURL: process.env.CIV1_WEB ?? 'http://localhost:31080',
    // HTTPS mode: map civ1.local to localhost without editing /etc/hosts.
    ignoreHTTPSErrors: process.env.CIV1_TLS === '1',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: {
      executablePath: process.env.CHROME_PATH || undefined,
      args: [
        '--no-sandbox',
        ...(process.env.CIV1_TLS === '1'
          ? ['--host-resolver-rules=MAP civ1.local 127.0.0.1']
          : []),
      ],
    },
  },
});
