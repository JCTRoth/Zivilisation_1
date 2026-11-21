import { test, expect } from '@playwright/test';

/**
 * CORE SETUP — runs FIRST, before every feature test.
 *
 * These tests verify that the application is running and that the core
 * landing page / dashboard loads successfully. This file belongs to the
 * `setup` Playwright project; the `chromium` project declares a dependency on
 * it, so if ANY test here fails the entire feature suite is skipped and the
 * run stops immediately (see `playwright.config.ts` for the fail-fast
 * strategy).
 */
test.describe('App is Running & Landing Page Loads', () => {
  // Serial mode: if the first critical check fails, stop checking right away.
  test.describe.configure({ mode: 'serial' });

  test('application responds over HTTP', async ({ request }) => {
    const response = await request.get('/');
    expect(response.ok()).toBeTruthy();
  });

  test('landing page loads with the correct document title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Zivilisation 1/);
  });

  test('React app mounts and renders the setup wizard', async ({ page }) => {
    await page.goto('/');
    // #gameContainer is the shell React renders into #root before a game starts.
    await expect(page.locator('#gameContainer')).toBeVisible({ timeout: 10_000 });
    // The wizard is the first screen — there is no hub in front of it — and
    // React-Bootstrap portals the dialog to <body>, so check it directly
    // rather than through #root.
    await expect(page.locator('h2.modal-title')).toContainText('Zivilisation 1', {
      timeout: 10_000,
    });
    await expect(page.getByRole('heading', { name: 'Choose Your Civilization' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Settings/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Field Manual/ })).toBeVisible();
  });

  test('page loads without uncaught JavaScript exceptions', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/');
    await expect(page.locator('h2.modal-title')).toContainText('Zivilisation 1', {
      timeout: 10_000,
    });

    // Any uncaught exception means the app is critically broken — fail fast.
    expect(pageErrors).toEqual([]);
  });
});
