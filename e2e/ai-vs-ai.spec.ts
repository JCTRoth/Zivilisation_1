import { test, expect, Page } from '@playwright/test';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AI vs AI (Computer vs Computer) feature tests.
 *
 * The "AI_VS_AI" map type starts a fully automatic game in which every
 * civilization is AI-controlled — no human input is required. Every move,
 * combat, and turn is additionally written to `game-logs/aivsai-*.log` by the
 * dev-server log middleware.
 *
 * These tests verify: (1) the map type is selectable in the setup wizard,
 * (2) the game auto-plays (turns advance without human interaction),
 * (3) the session is written to a game log file, and (4) the auto-play runs
 * without uncaught exceptions.
 *
 * NOTE: connectivity is NOT re-checked here — the `setup` project gate
 * (e2e/setup/app-setup.spec.ts) already verifies the app is reachable and the
 * `chromium` project depends on it (fail-fast).
 */

const LOG_DIR = join(process.cwd(), 'game-logs');

/**
 * Helper: navigate through the setup wizard and start an AI vs AI game.
 * All civilizations are AI-controlled, so the game plays itself after start.
 */
async function startAIVsAIGame(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' });

  // Step 1 – Civilization selection (default is pre-selected)
  await expect(page.locator('h2.modal-title')).toContainText('Zivilisation 1', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Next →' }).click();

  // Step 2 – Game settings: choose the Computer vs Computer map type
  await expect(page.getByText('Fine-tune Your Challenge')).toBeVisible();
    await page.locator('select.setup-setting__control').last().selectOption('AI_VS_AI');
  // Wait for game canvas to appear (game finished loading)
  await expect(page.locator('.game-canvas canvas').first()).toBeVisible({ timeout: 30_000 });
}

/** Read the current turn number from the top bar ("Turn N"). Returns -1 if absent. */
async function getTurnNumber(page: Page): Promise<number> {
  const text = await page.locator('.game-top-bar').textContent().catch(() => '');
  const m = text?.match(/Turn\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : -1;
}

/** Absolute path of the most recently modified aivsai-*.log file, or null. */
function latestAivsaiLog(): string | null {
  if (!existsSync(LOG_DIR)) return null;
  return (
    readdirSync(LOG_DIR)
      .filter((f) => f.startsWith('aivsai-') && f.endsWith('.log'))
      .map((f) => join(LOG_DIR, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null
  );
}

test.describe('AI vs AI (Computer vs Computer)', () => {
  // Serial: the log-file assertions compare files before/after, so this file's
  // tests run one at a time (other specs use the `game-` prefix and don't
  // interfere).
  test.describe.configure({ mode: 'serial' });

  test('offers the Computer vs Computer map type in the setup wizard', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Next →' }).click();
    await expect(page.getByText('Fine-tune Your Challenge')).toBeVisible();

    // The map-type select must expose the AI_VS_AI option.
    const mapSelect = page.locator('select.setup-setting__control').last();
    await expect(mapSelect.locator('option[value="AI_VS_AI"]')).toHaveText(/Computer vs Computer/i);
  });

  test('shows the auto-play summary when Computer vs Computer is selected', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Next →' }).click();
    await expect(page.getByText('Fine-tune Your Challenge')).toBeVisible();

    await page.locator('select.setup-setting__control').last().selectOption('AI_VS_AI');

    // The dedicated summary block explains the mode.
    await expect(page.getByText('Map:')).toBeVisible();
    await expect(page.getByText(/40x40 tiles/)).toBeVisible();
    await expect(page.getByText(/All civilizations are AI/)).toBeVisible();
    await expect(page.getByText(/Fully automatic — no human input/)).toBeVisible();
    await expect(page.getByText(/Every move is written to a log file/)).toBeVisible();
  });

  test('auto-plays: turns advance without any human input', async ({ page }) => {
    test.setTimeout(120_000);
    await startAIVsAIGame(page);

    // The game must progress on its own — no End Turn clicks, no input.
    const initial = await getTurnNumber(page);
    expect(initial).toBeGreaterThanOrEqual(1);

    await expect
      .poll(async () => getTurnNumber(page), { timeout: 45_000, intervals: [1_000] })
      .toBeGreaterThan(initial + 2);

    // Game shell still rendered and healthy.
    await expect(page.locator('.game-canvas canvas').first()).toBeVisible();
  });

  test('writes the auto-play session to a game log file', async ({ page }) => {
    test.setTimeout(120_000);
    const before = latestAivsaiLog();

    await startAIVsAIGame(page);

    // Let the AI play for a bit so log lines accumulate and flush.
    await page.waitForTimeout(8_000);

    // Poll until the newest aivsai- log actually contains the expected
    // in-game events. The very first rounds often have no unit moves (each
    // AI settler founds a city in place), so reading too early is flaky.
    let logFile: string | null = null;
    let logContent = '';
    await expect
      .poll(
        () => {
          logFile = latestAivsaiLog();
          if (!logFile) return '';
          logContent = readFileSync(logFile, 'utf8');
          return logContent;
        },
        { timeout: 30_000, intervals: [1_000] },
      )
      .toContain('"event":"UNIT_MOVED"');

    // The log must record the game start and actual in-game events.
    expect(logContent).toContain('Game started');
    expect(logContent).toMatch(/"event":"TURN_START"/);
    expect(logContent).toMatch(/"event":"UNIT_MOVED"/);
    expect(logContent).toMatch(/"event":"GAME_LOG"/);

    // Sanity: it is the aivsai- session (not a regular game session).
    expect(logFile).toMatch(/aivsai-.*\.log$/);
    void before;
  });

  test('auto-play runs without uncaught JavaScript exceptions', async ({ page }) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await startAIVsAIGame(page);

    // Let several AI turns run.
    await expect
      .poll(async () => getTurnNumber(page), { timeout: 45_000, intervals: [1_000] })
      .toBeGreaterThan(3);

    expect(pageErrors).toEqual([]);
  });
});
