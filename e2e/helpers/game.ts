import { expect, Page } from '@playwright/test';

/**
 * Shared Playwright helpers for the Zivilisation_1 e2e suite.
 *
 * These live in a dedicated module (not at the top of `game.spec.ts`) so new
 * feature specs can reuse them instead of copy-pasting setup logic. Feature
 * specs must NOT re-check HTTP connectivity — the `setup` project gate does
 * that (see `e2e/setup/app-setup.spec.ts` + `playwright.config.ts`).
 */

/**
 * Helper: navigate through the game setup wizard and start a game.
 * Uses the smallest/fastest map preset (CLOSEUP_1V1) to minimise wait time.
 */
export async function startGame(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' });

  // Step 1 – Civilization selection (default is pre-selected)
  await expect(page.locator('h2.modal-title')).toContainText('Zivilisation 1', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Next →' }).click();

  // Step 2 – Game settings
  await expect(page.getByText('Fine-tune Your Challenge')).toBeVisible();
  // Pick the smallest map for fast tests
  await page.locator('.control-card__select').last().selectOption('CLOSEUP_1V1');
  await page.getByRole('button', { name: '🏛️ Start Game' }).click();

  // Wait for game canvas to appear (game finished loading)
  await expect(page.locator('.game-canvas canvas').first()).toBeVisible({ timeout: 30_000 });

  // The game now asks for the first research with an informational modal
  // ("No Research Selected") — dismiss it so tests start on the board. The
  // tech-tree tests open the tree themselves.
  await closeResearchPrompt(page);
}

/**
 * Helper: dismiss the start-of-game "No Research Selected" modal when it is
 * open ("Decide Later" — research stays unset on purpose, feature tests
 * exercise the gate separately). No-op when the game did not ask for one.
 */
export async function closeResearchPrompt(page: Page): Promise<void> {
  const researchPrompt = page.locator('.modal').filter({ hasText: 'No Research Selected' });
  try {
    await researchPrompt.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    return; // no research prompt for this game
  }
  await researchPrompt.getByRole('button', { name: 'Decide Later' }).click();
  await expect(researchPrompt).toBeHidden({ timeout: 5_000 });
}

/**
 * Helper: open the info panel.
 * - Desktop (>= 992px): the panel is a static sidebar that starts open.
 * - Mobile: it is a drawer toggled via the "Panel" button in the bottom bar.
 */
export async function openSidePanel(page: Page): Promise<void> {
  const shell = page.locator('.side-panel-shell');
  // Only toggle via the bottom bar when it's visible (mobile layout).
  const bottomBar = page.locator('.mobile-bottom-bar');
  if (await bottomBar.isVisible().catch(() => false)) {
    if (!(await shell.evaluate((el) => el.classList.contains('is-open')))) {
      await page.locator('.mobile-bottom-bar__btn').nth(3).click();
    }
  }
  await expect(shell).toHaveClass(/is-open/);
}

/**
 * Helper: close the info panel (mobile drawer). No-op on desktop where the
 * panel is a static sidebar.
 */
export async function closeSidePanel(page: Page): Promise<void> {
  const shell = page.locator('.side-panel-shell');
  const bottomBar = page.locator('.mobile-bottom-bar');
  if (await bottomBar.isVisible().catch(() => false)) {
    if (await shell.evaluate((el) => el.classList.contains('is-open'))) {
      await page.locator('.mobile-bottom-bar__btn').nth(3).click();
      await expect(shell).not.toHaveClass(/is-open/);
    }
  }
}

/**
 * Open a top-bar menu (GAME / WORLD / INFO).
 * Scoped to the top bar because the always-visible bottom bar has
 * similarly named buttons (e.g. "Game menu").
 */
export async function openTopMenu(page: Page, menu: 'GAME' | 'WORLD' | 'INFO'): Promise<void> {
  await page.locator('.game-top-bar').getByRole('button', { name: menu, exact: true }).click();
}
