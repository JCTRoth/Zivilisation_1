import { expect, test, type Page } from '@playwright/test';
import { closeResearchPrompt } from './helpers/game';

/** Clear the start-of-game dialogs that sit over the top bar. */
async function dismissStartDialogs(page: Page): Promise<void> {
  await closeResearchPrompt(page);
  const story = page.locator('.story-modal');
  if (await story.isVisible().catch(() => false)) {
    await story.getByRole('button', { name: 'Continue' }).click();
    await expect(story).toBeHidden();
  }
}

/**
 * The offline promise, end to end.
 *
 * A game that needs no other players must keep working when the network is
 * gone: the app must launch from the service worker cache, the state must
 * be saved on the device, and the game must be resumable after a reload —
 * all without a server.
 */
test.describe('offline play', () => {
  test('the app launches and shows the offline banner with the network down', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Choose Your Civilization' })).toBeVisible({ timeout: 60_000 });

    // Wait until the service worker is installed and controlling the page.
    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const worker = registration.active;
      if (!worker) return 'none';
      if (worker.state === 'activated') return 'activated';
      await new Promise<void>((resolve) => {
        const onChange = () => {
          if (worker.state === 'activated') {
            worker.removeEventListener('statechange', onChange);
            resolve();
          }
        };
        worker.addEventListener('statechange', onChange);
      });
      return worker.state;
    });
    expect(state).toBe('activated');

    await context.setOffline(true);
    // The browser tells the open page that the network is gone.
    await expect(page.locator('.pwa-banner--offline')).toBeVisible({ timeout: 15_000 });

    // Now the real test: a *cold* launch with no network must still boot
    // from the service worker cache.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Choose Your Civilization' })).toBeVisible({ timeout: 60_000 });

    await context.setOffline(false);
  });

  test('a game saved offline is still there after a reload', async ({ page, context }) => {
    await page.goto('/?quickstart=1&noanim=1');
    await expect(page.locator('.game-canvas canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => navigator.serviceWorker.ready);

    // Go offline and save into the local slot.
    await context.setOffline(true);
    await page.keyboard.press('Control+s');
    await expect(page.locator('.app-toast')).toContainText(/saved locally/i, { timeout: 15_000 });

    // A cold reload lands on the wizard itself; saving lives in the game.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Choose Your Civilization' })).toBeVisible({ timeout: 60_000 });

    // Boot a fresh local game. The in-game library hydrates IndexedDB
    // asynchronously, so open it first and wait for the saved entry.
    await page.goto('/?quickstart=1&noanim=1');
    await expect(page.locator('.game-canvas canvas').first()).toBeVisible({ timeout: 60_000 });
    await dismissStartDialogs(page);
    await page.locator('.game-top-bar').getByRole('button', { name: 'GAME', exact: true }).click();
    await page.getByRole('button', { name: /Campaigns/i }).click();
    await expect(page.locator('.campaign-list__item').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('.pwa-panel__foot .pwa-btn').click();
    await expect(page.locator('.pwa-panel')).toBeHidden({ timeout: 15_000 });

    // Restore the saved slot from the keyboard.
    await page.keyboard.press('Control+l');
    await expect(page.locator('.app-toast')).toContainText(/loaded from the local save/i, { timeout: 15_000 });

    await context.setOffline(false);
  });
});
