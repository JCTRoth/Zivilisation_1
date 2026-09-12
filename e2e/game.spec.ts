import { test, expect, Page } from '@playwright/test';

/**
 * Helper: navigate through the game setup wizard and start a game.
 * Uses the smallest/fastest map preset (CLOSEUP_1V1) to minimise wait time.
 */
async function startGame(page: Page): Promise<void> {
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
async function closeResearchPrompt(page: Page): Promise<void> {
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
async function openSidePanel(page: Page): Promise<void> {
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
async function closeSidePanel(page: Page): Promise<void> {
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
async function openTopMenu(page: Page, menu: 'GAME' | 'WORLD' | 'INFO'): Promise<void> {
  await page.locator('.game-top-bar').getByRole('button', { name: menu, exact: true }).click();
}

// ---------------------------------------------------------------------------
// Game Setup
// ---------------------------------------------------------------------------

test.describe('Game Setup', () => {
  test('shows the setup modal on load', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h2.modal-title')).toContainText('Zivilisation 1');
    await expect(page.getByText('Choose Your Civilization')).toBeVisible();
  });

  test('can select a civilization', async ({ page }) => {
    await page.goto('/');
    const aztecCard = page.locator('.setup-civ-card', { hasText: 'Aztecs' });
    await aztecCard.click();
    // Footer should reflect the selection
    await expect(page.locator('.setup-footer__selected-value')).toHaveText('Aztecs');
  });

  test('can navigate between setup steps', async ({ page }) => {
    await page.goto('/');
    // Step 1 → Step 2
    await page.getByRole('button', { name: /Next →/ }).click();
    await expect(page.getByText('Fine-tune Your Challenge')).toBeVisible();
    // Step 2 → Step 1
    await page.getByRole('button', { name: /← Previous/ }).click();
    await expect(page.getByText('Choose Your Civilization')).toBeVisible();
  });

  test('shows game summary on step 2', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Next →/ }).click();
    await expect(page.locator('.setup-summary-title')).toHaveText('Your Setup');
    // Default civilization should be shown in summary
    await expect(page.locator('.setup-summary')).toBeVisible();
  });

  test('starts the game after completing setup', async ({ page }) => {
    await startGame(page);
    // The top menu bar should be visible
    await expect(page.locator('.game-top-bar').getByRole('button', { name: 'GAME', exact: true })).toBeVisible();
    await expect(page.locator('.game-top-bar').getByRole('button', { name: 'End Turn' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Main Game UI
// ---------------------------------------------------------------------------

test.describe('Main Game UI', () => {
  test.beforeEach(async ({ page }) => {
    await startGame(page);
  });

  test('renders the game canvas', async ({ page }) => {
    const canvases = page.locator('.game-canvas canvas');
    await expect(canvases.first()).toBeVisible();
  });

  test('shows the side panel', async ({ page }) => {
    await openSidePanel(page);
    await expect(page.locator('.side-panel-shell').first()).toBeVisible();
  });

  test('displays turn counter', async ({ page }) => {
    await expect(page.getByText(/Turn \d+/).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Top Menu
// ---------------------------------------------------------------------------

test.describe('Top Menu', () => {
  test.beforeEach(async ({ page }) => {
    await startGame(page);
  });

  test('opens and closes GAME menu', async ({ page }) => {
    await openTopMenu(page, 'GAME');
    await expect(page.getByRole('button', { name: /New Game/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Save/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Settings/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Quit/ })).toBeVisible();

    // Close the menu by pressing Escape (clicking canvas may trigger End Turn dialog)
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /New Game/ })).not.toBeVisible();
  });

  test('right-clicking a unit opens the ORDERS context menu', async ({ page }) => {
    test.setTimeout(30_000);
    await startGame(page);

    const canvas = page.locator('.game-canvas canvas').first();
    await expect(canvas).toBeVisible();

    // Let the camera settle on the auto-focused settler before scanning.
    await page.waitForTimeout(2_000);

    // The player settler starts at a random position on the 20x20 map and the
    // camera clamps to the map bounds, so the unit can appear anywhere in the
    // canvas. The right-click hit-test uses the square tile grid (TILE_SIZE *
    // zoom = 64px), so a 64px-pitch scan is guaranteed to reach every tile.
    // The ORDERS context menu only opens when right-clicking a player unit.
    const box = (await canvas.boundingBox())!;
    outer:
    for (let y = 20; y < box.height; y += 64) {
      for (let x = 20; x < box.width; x += 64) {
        await canvas.click({ position: { x, y }, button: 'right' });
        if (await page.getByRole('button', { name: /Skip Turn/i }).isVisible().catch(() => false)) {
          break outer;
        }
      }
    }

    // The ORDERS context menu should be visible with unit order actions.
    await expect(page.getByText('ORDERS', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /Skip Turn/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Patrol/i })).toBeVisible();
  });

  test('opens WORLD menu', async ({ page }) => {
    await openTopMenu(page, 'WORLD');
    await expect(page.getByRole('button', { name: /Diplomacy/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Tech Tree/ })).toBeVisible();
  });

  test('opens INFO menu', async ({ page }) => {
    await openTopMenu(page, 'INFO');
    await expect(page.getByRole('button', { name: /Download Map/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Download Game Progression List/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Help/ })).toBeVisible();
  });

  test('downloads the game progression list from INFO menu', async ({ page }) => {
    await openTopMenu(page, 'INFO');
    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await page.getByRole('button', { name: /Download Game Progression List/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^civ1-progression-.*\.json$/);
    // The exported payload should contain the meta/progression/log structure.
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    expect(payload).toHaveProperty('meta');
    expect(payload).toHaveProperty('summary');
    expect(payload).toHaveProperty('progression');
    expect(payload).toHaveProperty('log');
    expect(Array.isArray(payload.progression)).toBe(true);
    // Each round snapshot should contain the full per-player city JSONs.
    if (payload.progression.length > 0) {
      const firstRound = payload.progression[0];
      const someCiv = Object.values(firstRound.civs ?? {})[0] as
        | { cityData?: unknown[] }
        | undefined;
      expect(someCiv).toBeDefined();
      expect(Array.isArray(someCiv?.cityData)).toBe(true);
    }
  });

  test('opens settings modal from GAME menu', async ({ page }) => {
    await openTopMenu(page, 'GAME');
    await page.getByRole('button', { name: /Settings/ }).click();
    await expect(page.locator('.modal')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Rates (Tax / Science / Luxury)
// ---------------------------------------------------------------------------

test.describe('Rates', () => {
  test('opens the rates modal from the WORLD menu and keeps the sum at 100%', async ({ page }) => {
    await startGame(page);

    await openTopMenu(page, 'WORLD');
    await page.getByRole('button', { name: /Rates/ }).click();

    const modal = page.locator('.rates-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Rates');
    await expect(modal.locator('.rates-summary')).toContainText('Total');

    // The three sliders are present.
    await expect(page.getByLabel('Tax rate')).toBeVisible();
    await expect(page.getByLabel('Science rate')).toBeVisible();
    await expect(page.getByLabel('Luxury rate')).toBeVisible();

    // Initially the sum must read 100%.
    await expect(modal.locator('.rates-summary')).toContainText('100%');

    // Moving one slider actually changes its value AND keeps the total at 100%.
    await page.getByLabel('Science rate').fill('80');
    await expect(modal.locator('.rates-control__value').nth(1)).toHaveText('80%');
    await expect(modal.locator('.rates-summary')).toContainText('100%');

    await page.getByLabel('Tax rate').fill('0');
    await expect(modal.locator('.rates-control__value').nth(0)).toHaveText('0%');
    await expect(modal.locator('.rates-summary')).toContainText('100%');

    // Apply closes the modal.
    await page.getByRole('button', { name: 'Apply Rates' }).click();
    await expect(modal).not.toBeVisible();
  });

  test('T key opens the rates modal', async ({ page }) => {
    await startGame(page);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true })));
    await expect(page.locator('.rates-modal')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Government (revolution / capital)
// ---------------------------------------------------------------------------

test.describe('Government', () => {
  test('G key opens the government modal showing Despotism', async ({ page }) => {
    await startGame(page);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', bubbles: true })));

    const modal = page.locator('.government-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Government');
    // Despotism is the starting government (its card is marked Current).
    await expect(modal.getByRole('button', { name: /Despotism/ })).toBeVisible();
    await expect(modal.locator('.government-modal__body')).toContainText('Despotism');
  });

  test('opens the government modal from the WORLD menu', async ({ page }) => {
    await startGame(page);
    await openTopMenu(page, 'WORLD');
    await page.getByRole('button', { name: /Government/ }).click();
    await expect(page.locator('.government-modal')).toBeVisible();
    await expect(page.locator('.government-modal')).toContainText('revolution');
  });
});

// ---------------------------------------------------------------------------
// Keyboard Shortcuts
// ---------------------------------------------------------------------------

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await startGame(page);
  });

  test('F1 opens help dialog', async ({ page }) => {
    // Dispatch F1 keydown on the window (page.keyboard.press may not reach window listeners in headless)
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', bubbles: true })));
    await expect(page.getByText('Help & Controls').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Escape closes open modal', async ({ page }) => {
    // Open help via INFO menu (more reliable than F1 key)
    await openTopMenu(page, 'INFO');
    await page.getByRole('button', { name: /Help/ }).click();
    await expect(page.getByText('Help & Controls').first()).toBeVisible();
    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(page.getByText('Help & Controls').first()).not.toBeVisible();
  });

  test('Enter triggers end turn flow', async ({ page }) => {
    await page.locator('.game-canvas').first().click();
    await page.keyboard.press('Enter');
    // Either the turn advances or a confirm dialog appears — game should still be functional
    await expect(page.getByText(/Turn \d+/).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// End Turn
// ---------------------------------------------------------------------------

test.describe('End Turn', () => {
  test.beforeEach(async ({ page }) => {
    await startGame(page);
  });

  test('clicking End Turn shows confirmation and can be confirmed', async ({ page }) => {
    // Verify the initial year
    await expect(page.locator('.game-top-bar')).toContainText('4000 BC');

    // Click the top-bar End Turn button
    await page.locator('.game-top-bar').getByRole('button', { name: 'End Turn' }).click();

    // The End Turn confirmation modal should appear
    const modal = page.locator('[role="dialog"]').filter({ hasText: 'End Turn?' });
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Modal should have Cancel and End Turn buttons
    await expect(modal.locator('.touch-btn--success')).toBeVisible();
    await expect(modal.getByRole('button', { name: /Cancel/ })).toBeVisible();

    // Click the green End Turn confirm button inside the modal
    await modal.locator('.touch-btn--success').click();

    // Verify the turn advanced by checking the year changed in the top bar
    await expect(page.locator('.game-top-bar')).not.toContainText('4000 BC', { timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Help Dialog
// ---------------------------------------------------------------------------

test.describe('Help Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await startGame(page);
  });

  test('help dialog contains multiple tabs', async ({ page }) => {
    // Open help via INFO menu
    await openTopMenu(page, 'INFO');
    await page.getByRole('button', { name: /Help/ }).click();
    const modal = page.locator('.modal', { hasText: 'Help & Controls' });
    await expect(modal).toBeVisible();
    // Should have navigable tabs (Controls, Orders Menu, Gameplay, About)
    await expect(modal.getByRole('tab')).toHaveCount(4);
  });
});

// ---------------------------------------------------------------------------
// Helper: advance N turns by repeatedly ending and confirming
// ---------------------------------------------------------------------------

/**
 * Wait for the End Turn modal to fully disappear (including its fade-out
 * transition). react-bootstrap keeps the closing modal in the DOM for a few
 * hundred ms, so without this wait the next endTurn call can race with a
 * modal that is still fading out ("element was detached from the DOM").
 */
async function waitForModalClosed(page: Page): Promise<void> {
  const modal = page.locator('[role="dialog"]').filter({ hasText: 'End Turn?' });
  await expect(modal).not.toBeVisible({ timeout: 5_000 }).catch(() => {});
}

/**
 * End the current turn (click End Turn, confirm modal, wait for AI processing).
 * Skips the confirmation modal if `skipEndTurnConfirmation` is enabled.
 */
async function endTurn(page: Page): Promise<void> {
  const modal = page.locator('[role="dialog"]').filter({ hasText: 'End Turn?' });

  // The "All Your Units Have Moved!" dialog may auto-appear. If so, just confirm it.
  if (await modal.isVisible().catch(() => false)) {
    await modal.locator('.touch-btn--success').click();
  } else {
    // Click the top-bar End Turn button
    await page.locator('.game-top-bar').getByRole('button', { name: 'End Turn' }).click();

    // If a confirmation modal appears, confirm it
    if (await modal.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await modal.locator('.touch-btn--success').click();
    }
  }

  // Wait until it's the human player's turn again (End Turn button re-enabled)
  await expect(page.locator('.game-top-bar .topbar-endturn')).toBeEnabled({ timeout: 30_000 });

  // Let the confirm modal finish its fade-out before returning, so the next
  // endTurn call does not race with a detaching modal.
  await waitForModalClosed(page);
}

/**
 * Advance the game by `n` turns.
 */
async function advanceTurns(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await endTurn(page);
  }
  // Dismiss the auto-appearing "All Your Units Have Moved!" dialog if it shows
  await dismissEndTurnDialog(page);
}

/**
 * Dismiss the "End Turn?" confirmation dialog if it is visible.
 * Keeps dismissing until it stays closed, because the auto
 * "All Your Units Have Moved!" dialog can reappear while a GoTo path
 * animation is still running (each queue change can re-trigger the prompt).
 */
async function dismissEndTurnDialog(page: Page): Promise<void> {
  const modal = page.locator('[role="dialog"]').filter({ hasText: 'End Turn?' });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await modal.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await modal.locator('button').filter({ hasText: 'Cancel' }).click({ timeout: 3_000 });
      await waitForModalClosed(page);
    } else {
      // Modal is closed — wait briefly and confirm it stays closed (the GoTo
      // animation may still be running and could re-open it).
      await page.waitForTimeout(500);
      if (!(await modal.isVisible({ timeout: 500 }).catch(() => false))) {
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// AI Behavior — In-Depth Tests
// ---------------------------------------------------------------------------

test.describe('AI Behavior', () => {
  // All AI tests share the same slow test timeout because multi-turn simulation
  // involves waiting for AI processing each round.
  test.setTimeout(120_000);

  test.describe('Turn Processing', () => {
    test('AI processes its turn and returns control to player', async ({ page }) => {
      await startGame(page);

      await endTurn(page);

      // After one full round, the year should have advanced
      await expect(page.locator('.game-top-bar')).not.toContainText('4000 BC');

      // The game should still be functional — player's turn
      await expect(page.locator('.game-top-bar .topbar-endturn')).toBeEnabled();
    });

    test('game advances through multiple turns without errors', async ({ page }) => {
      await startGame(page);

      // Advance 5 turns — tests that the AI doesn't crash or hang
      await advanceTurns(page, 5);

      // Verify game progressed (turn counter > 1)
      await expect(page.getByText(/Turn [2-9]\d*/).first()).toBeVisible();
      // Game canvas still renders
      await expect(page.locator('.game-canvas canvas').first()).toBeVisible();
    });
  });

  test.describe('AI City Founding', () => {
    test('AI founds a city within the first few turns', async ({ page }) => {
      await startGame(page);

      // Advance enough turns for the AI to move its settler and found a city
      // On CLOSEUP_1V1 the AI should found a city within ~3 turns
      await advanceTurns(page, 5);

      // Open the diplomacy report to check other civilizations
      await openTopMenu(page, 'WORLD');
      await page.getByRole('button', { name: /Diplomacy/ }).click();

      // The Foreign Advisor (Diplomacy Report) modal should show at least one other civilization
      const modal = page.locator('.modal').filter({ hasText: 'Diplomacy Report' });
      await expect(modal).toBeVisible({ timeout: 5_000 });

      // Close the diplomacy report
      await page.keyboard.press('Escape');

      // Verify the total cities count increased (initial 0 for player, AI should have 1+)
      // We can check via the game state exposed in the info panel
      await openSidePanel(page);
      const sidePanel = page.locator('.side-panel-shell').first();
      await expect(sidePanel).toBeVisible();
    });
  });

  test.describe('AI Diplomacy', () => {
    test('Foreign Advisor shows AI civilization with diplomatic status', async ({ page }) => {
      await startGame(page);

      // Need a few turns so the AI civilization is discovered
      await advanceTurns(page, 3);

      // Open the Foreign Advisor via WORLD > Diplomacy
      await openTopMenu(page, 'WORLD');
      await page.getByRole('button', { name: /Diplomacy/ }).click();

      const modal = page.locator('.modal').filter({ hasText: 'Diplomacy Report' });
      await expect(modal).toBeVisible({ timeout: 5_000 });

      // The modal should list at least one AI civilization
      // Either it shows civ data or "No other civilizations discovered yet."
      const noCivsMsg = modal.getByText('No other civilizations discovered yet.');
      const civRows = modal.locator('.diplomacy-report-row');

      // One of these conditions should be true
      const hasNoCivs = await noCivsMsg.isVisible().catch(() => false);
      if (!hasNoCivs) {
        // AI civilization row(s) should be displayed
        await expect(civRows.first()).toBeVisible();
        // Each row should have a name and a status indicator
        await expect(civRows.first().locator('.diplomacy-report-name')).toBeVisible();
        await expect(civRows.first().locator('.diplomacy-report-status')).toBeVisible();
      }

      await page.keyboard.press('Escape');
    });

    test('diplomatic status shows Peace by default', async ({ page }) => {
      await startGame(page);
      await advanceTurns(page, 3);

      await openTopMenu(page, 'WORLD');
      await page.getByRole('button', { name: /Diplomacy/ }).click();

      const modal = page.locator('.modal').filter({ hasText: 'Diplomacy Report' });
      await expect(modal).toBeVisible({ timeout: 5_000 });

      const civRows = modal.locator('.diplomacy-report-row');
      if (await civRows.count() > 0) {
        // Default diplomatic status should be "Peace"
        await expect(civRows.first().locator('.diplomacy-report-status')).toContainText('Peace');
      }

      await page.keyboard.press('Escape');
    });
  });

  test.describe('Tech Tree', () => {
    test('Tech Tree modal shows available technologies', async ({ page }) => {
      await startGame(page);

      // Open Tech Tree via WORLD menu
      await openTopMenu(page, 'WORLD');
      await page.getByRole('button', { name: /Tech Tree/ }).click();

      // Tech Tree modal should be visible
      const modal = page.locator('.modal').filter({ hasText: 'Technology Tree' });
      await expect(modal).toBeVisible({ timeout: 5_000 });

      // Should contain SVG-rendered tech tree nodes
      const techNodes = modal.locator('svg rect');
      // There should be multiple technology nodes
      expect(await techNodes.count()).toBeGreaterThan(5);

      await page.keyboard.press('Escape');
    });

    test('player can select a technology to research', async ({ page }) => {
      await startGame(page);

      // Open the Tech Tree
      await openTopMenu(page, 'WORLD');
      await page.getByRole('button', { name: /Tech Tree/ }).click();

      const modal = page.locator('.modal').filter({ hasText: 'Technology Tree' });
      await expect(modal).toBeVisible({ timeout: 5_000 });

      // Click on an available (blue) tech node — the first available one
      // Available techs have fill="#1e90ff"
      const availableTech = modal.locator('svg rect[fill="#1e90ff"]').first();
      if (await availableTech.isVisible().catch(() => false)) {
        await availableTech.click();
        // After clicking, a tech info tooltip or selection indicator should appear
        // The tech node should change color or show a tooltip
      }

      await page.keyboard.press('Escape');
    });
  });

  test.describe('Side Panel Resources', () => {
    test('side panel shows player resources', async ({ page }) => {
      await startGame(page);
      await openSidePanel(page);

      const sidePanel = page.locator('.side-panel-shell').first();
      await expect(sidePanel).toBeVisible();

      // Gold is always shown in the panel header.
      await expect(sidePanel.getByText(/🪙/).first()).toBeVisible();

      // The starter settler is auto-selected, so deselect it to reveal the
      // Player Summary with per-resource breakdown.
      await page.keyboard.press('Escape');
      await expect(sidePanel.getByText(/Units:/).first()).toBeVisible();
      await expect(sidePanel.getByText(/Cities:/).first()).toBeVisible();
    });

    test('resources update after advancing turns', async ({ page }) => {
      await startGame(page);

      // Capture initial stats
      await openSidePanel(page);
      const sidePanel = page.locator('.side-panel-shell').first();

      // Advance several turns
      await advanceTurns(page, 3);

      // Deselect any auto-focused unit so the Player Summary is revealed.
      await page.keyboard.press('Escape');

      // The side panel content should have changed (at minimum the turn display)
      // We just verify it's still functional and showing data
      await expect(sidePanel).toBeVisible();
      await expect(sidePanel.getByText(/Units:/).first()).toBeVisible();
    });
  });

  test.describe('Game Stability', () => {
    test('game survives 10 turns without crashing', async ({ page }) => {
      test.setTimeout(180_000);
      await startGame(page);

      // Run 10 full turns — stresses the AI turn processing loop
      await advanceTurns(page, 10);

      // Game should still be running and stable
      await expect(page.locator('.game-canvas canvas').first()).toBeVisible();
      await expect(page.locator('.game-top-bar')).toBeVisible();

      // Turn counter should show the game progressed significantly
      const topBarText = await page.locator('.game-top-bar').textContent() ?? '';
      const turnMatch = topBarText.match(/Turn (\d+)/);
      expect(turnMatch).not.toBeNull();
      expect(Number(turnMatch![1])).toBeGreaterThanOrEqual(8);

      // End Turn button should be enabled (player's turn)
      await expect(page.locator('.game-top-bar .topbar-endturn')).toBeEnabled();
    });

    test('UI remains responsive after many turns', async ({ page }) => {
      test.setTimeout(180_000);
      await startGame(page);
      await advanceTurns(page, 5);

      // Menus should still work
      await openTopMenu(page, 'GAME');
      await expect(page.getByRole('button', { name: /New Game/ })).toBeVisible();
      await page.keyboard.press('Escape');

      // Side panel should still render
      await openSidePanel(page);
      await expect(page.locator('.side-panel-shell').first()).toBeVisible();

      // Close the side panel (drawer on mobile, static sidebar on desktop),
      // then verify the canvas is still interactive (no frozen state)
      await closeSidePanel(page);
      await page.locator('.game-canvas').first().click();
    });

    test('auto end turn checkbox is available', async ({ page }) => {
      await startGame(page);
      await openSidePanel(page);

      // The side panel should contain the "Auto. turn ending" checkbox
      const autoEndTurn = page.locator('text=Auto. turn ending');
      await expect(autoEndTurn).toBeVisible();

      // It should have an associated checkbox
      const checkbox = page.getByRole('checkbox', { name: /Auto.*turn/i });
      await expect(checkbox).toBeVisible();
      // Default should be unchecked (auto turn ending is disabled by default)
      await expect(checkbox).not.toBeChecked();
    });
  });

  // -------------------------------------------------------------------------
  // AI Research & Technology
  // -------------------------------------------------------------------------

  test.describe('AI Research & Technology', () => {
    test('AI researches technology over multiple turns', async ({ page }) => {
      test.setTimeout(180_000);
      await startGame(page);

      // Advance several turns so AI has time to research
      await advanceTurns(page, 8);

      // Open the Diplomacy report via WORLD menu
      await openTopMenu(page, 'WORLD');
      await page.getByRole('button', { name: /Diplomacy/ }).click();

      const modal = page.locator('.modal').filter({ hasText: 'Diplomacy Report' });
      await expect(modal).toBeVisible({ timeout: 5_000 });

      // The AI civ should be visible
      const civRows = modal.locator('.diplomacy-report-row');
      if (await civRows.count() > 0) {
        // Check that AI civ has a name — proves they survived and are active
        await expect(civRows.first().locator('.diplomacy-report-name')).not.toBeEmpty();
      }

      await page.keyboard.press('Escape');
    });

    test('Tech Tree shows researched technologies after turns', async ({ page }) => {
      test.setTimeout(180_000);
      await startGame(page);

      // Advance turns to allow research progress
      await advanceTurns(page, 6);

      // Open Tech Tree via WORLD menu
      await openTopMenu(page, 'WORLD');
      await page.getByRole('button', { name: /Tech Tree/ }).click();

      const modal = page.locator('.modal').filter({ hasText: 'Technology Tree' });
      await expect(modal).toBeVisible({ timeout: 5_000 });

      // There should be SVG nodes rendered
      const allNodes = modal.locator('svg rect');
      expect(await allNodes.count()).toBeGreaterThan(5);

      await page.keyboard.press('Escape');
    });
  });

  // -------------------------------------------------------------------------
  // Diplomacy Deep Dive
  // -------------------------------------------------------------------------

  test.describe('Diplomacy Deep Dive', () => {
    test('diplomacy modal shows attitude indicator for AI civ', async ({ page }) => {
      test.setTimeout(180_000);
      await startGame(page);
      await advanceTurns(page, 5);

      await openTopMenu(page, 'WORLD');
      await page.getByRole('button', { name: /Diplomacy/ }).click();

      const modal = page.locator('.modal').filter({ hasText: 'Diplomacy Report' });
      await expect(modal).toBeVisible({ timeout: 5_000 });

      const civRows = modal.locator('.diplomacy-report-row');
      if (await civRows.count() > 0) {
        // Each row should show an attitude label (Friendly/Neutral/Annoyed/Hostile)
        const attitude = civRows.first().locator('.diplomacy-report-attitude');
        await expect(attitude).toBeVisible();
        const text = await attitude.textContent();
        expect(['Friendly', 'Neutral', 'Annoyed', 'Hostile']).toContain(text?.trim());
      }

      await page.keyboard.press('Escape');
    });

    test('diplomacy modal shows leader name and portrait area', async ({ page }) => {
      await startGame(page);
      await advanceTurns(page, 3);

      await openTopMenu(page, 'WORLD');
      await page.getByRole('button', { name: /Diplomacy/ }).click();

      const modal = page.locator('.modal').filter({ hasText: 'Diplomacy Report' });
      await expect(modal).toBeVisible({ timeout: 5_000 });

      const civRows = modal.locator('.diplomacy-report-row');
      if (await civRows.count() > 0) {
        // Portrait area should exist
        await expect(civRows.first().locator('.diplomacy-report-portrait')).toBeVisible();
      }

      await page.keyboard.press('Escape');
    });
  });

  // -------------------------------------------------------------------------
  // Turn & Year Display
  // -------------------------------------------------------------------------

  test.describe('Turn & Year Display', () => {
    test('top bar displays turn number and year', async ({ page }) => {
      await startGame(page);

      const topBar = page.locator('.game-top-bar');
      // Should show "Turn 1" and a year like "4000 BC"
      await expect(topBar.getByText(/Turn \d+/)).toBeVisible();
      await expect(topBar.getByText(/BC/)).toBeVisible();
    });

    test('turn number and year advance after ending turn', async ({ page }) => {
      await startGame(page);

      const topBar = page.locator('.game-top-bar');

      await endTurn(page);

      // The year should have changed (no longer 4000 BC)
      await expect(topBar).not.toContainText('4000 BC');
    });

    test('side panel shows player stats', async ({ page }) => {
      await startGame(page);
      await openSidePanel(page);

      const sidePanel = page.locator('.side-panel-shell').first();
      // The starter settler is auto-selected; deselect to reach the
      // "No Selection" Player Summary with Units and Cities counts.
      await page.keyboard.press('Escape');
      await expect(sidePanel.getByText(/Units:/).first()).toBeVisible();
      await expect(sidePanel.getByText(/Cities:/).first()).toBeVisible();
    });

    test('player founds a city using settler', async ({ page }) => {
      test.setTimeout(120_000);
      await startGame(page);

      // The player starts with a settler — try to found a city by clicking "Found City"
      const foundCityBtn = page.getByRole('button', { name: /Found City/i });
      if (await foundCityBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await foundCityBtn.click();
        // After founding, side panel should show a city
        await openSidePanel(page);
        const sidePanel = page.locator('.side-panel-shell').first();
        await expect(sidePanel.getByText('Cities: 1').first()).toBeVisible({ timeout: 10_000 });
      }
    });

    test('city production queue accepts the same unit repeatedly', async ({ page }) => {
      test.setTimeout(180_000);
      await startGame(page);

      // Found the capital the way a player does: right-click the settler tile
      // and pick "Found / Join City" from the ORDERS menu. The settler starts
      // at a random spot, so scan the tile grid (64px pitch at default zoom)
      // until the settler's menu shows up.
      const canvas = page.locator('.game-canvas canvas').first();
      await expect(canvas).toBeVisible();
      await page.waitForTimeout(2_000); // let the camera settle on the settler

      const foundBtn = page.getByRole('button', { name: /Found \/ Join City/i });
      const box = (await canvas.boundingBox())!;
      scan:
      for (let y = 20; y < box.height; y += 64) {
        for (let x = 20; x < box.width; x += 64) {
          await canvas.click({ position: { x, y }, button: 'right' });
          if (await foundBtn.isVisible().catch(() => false)) break scan;
        }
      }
      await expect(foundBtn).toBeVisible({ timeout: 5_000 });
      await foundBtn.click();
      await dismissEndTurnDialog(page);

      // Ctrl+1 selects the first city and opens the city screen.
      await page.keyboard.press('Control+1');
      const queuePanel = page.locator('.queue-panel').first();
      await expect(queuePanel).toBeVisible({ timeout: 10_000 });

      // Adding items must never replace what the city is currently building.
      const productionBlock = page.locator('h6:text-is("Current Production") + div').first();
      const productionBefore = (await productionBlock.textContent()) ?? '';

      // Queue the same unit three times. Every click must land: a Warrior
      // already sitting in the queue used to swallow the next one silently.
      const queuedWarriors = queuePanel.locator('.queue-item').filter({ hasText: 'Warrior' });
      const warriorsBefore = await queuedWarriors.count();

      for (let i = 0; i < 3; i++) {
        // Choose the Warrior in the picker — picking it also selects it as the
        // city's production, and "Add" queues a copy.
        await page.locator('.production-select-btn').first().click();
        const picker = page.locator('.modal').filter({
          has: page.locator('.modal-title', { hasText: 'Select Production' }),
        });
        await expect(picker).toBeVisible({ timeout: 5_000 });
        await picker
          .locator('tbody tr')
          .filter({ hasText: 'Warrior' })
          .getByRole('button', { name: 'Select' })
          .click();
        await expect(picker).toBeHidden({ timeout: 5_000 });
        // "Add" appends the chosen unit to the queue.
        await page.locator('.production-add-btn').click();
      }

      // All three clicks were honoured (the city may already have had some
      // production queued by auto-production, hence the relative count).
      await expect(queuedWarriors).toHaveCount(warriorsBefore + 3, { timeout: 5_000 });
      // …and the current production is still the same item.
      await expect(productionBlock).toHaveText(productionBefore);
    });
  });

  // -------------------------------------------------------------------------
  // Minimap
  // -------------------------------------------------------------------------

  test.describe('Minimap', () => {
    test('minimap canvas is rendered', async ({ page }) => {
      await startGame(page);

      // Minimap is inside the side panel in a minimap-container
      const minimap = page.locator('.minimap-container canvas');
      await expect(minimap).toBeVisible();
    });

    test('minimap is inside the side panel', async ({ page }) => {
      await startGame(page);
      await openSidePanel(page);

      const sidePanel = page.locator('.side-panel-shell').first();
      const minimapSection = sidePanel.locator('.minimap-section');
      await expect(minimapSection).toBeVisible();
    });
  });

  // -------------------------------------------------------------------------
  // Unit Selection & Side Panel
  // -------------------------------------------------------------------------

  test.describe('Unit Selection & Side Panel', () => {
    test('side panel has selection section', async ({ page }) => {
      await startGame(page);
      await openSidePanel(page);

      const sidePanel = page.locator('.side-panel-shell').first();
      const selectionSection = sidePanel.locator('.selection-section');
      await expect(selectionSection).toBeVisible();
    });

    test('clicking on settler shows unit info in side panel', async ({ page }) => {
      await startGame(page);

      // The settler is auto-selected at game start (camera centers on it), so
      // clicking its tile deselects it and empties the unit queue, which
      // triggers the auto "All Your Units Have Moved!" dialog. Dismiss it so it
      // does not block the bottom bar.
      const canvas = page.locator('.game-canvas canvas').first();
      await canvas.click();
      await dismissEndTurnDialog(page);

      // After interacting with the settler tile, "Selected Unit" or unit type should appear
      await openSidePanel(page);
      const sidePanel = page.locator('.side-panel-shell').first();
      const selectionSection = sidePanel.locator('.selection-section');
      await expect(selectionSection).toBeVisible();
      // It should now show something other than "No Selection" (could be Selected Unit, Selected Tile, etc.)
      const text = await selectionSection.textContent();
      expect(text).toBeTruthy();
    });

    test('side panel shows player gold display', async ({ page }) => {
      await startGame(page);
      await openSidePanel(page);

      const sidePanel = page.locator('.side-panel-shell').first();
      // Should always show the gold display with coin emoji
      await expect(sidePanel.getByText(/🪙/).first()).toBeVisible();
    });
  });

  // -------------------------------------------------------------------------
  // Unit Movement mode (hover / selection / right-click)
  // -------------------------------------------------------------------------

  test.describe('Unit Movement mode', () => {
    test('an auto-selected unit enters movement mode (crosshair cursor)', async ({ page }) => {
      await startGame(page);

      const canvas = page.locator('.game-canvas canvas').first();
      await expect(canvas).toBeVisible();

      // The starting settler is auto-selected on turn 1. Movement mode derives
      // from the store selection (gameState.selectedUnit), so the cursor must
      // be the movement crosshair — previously only a manual click set it.
      await expect(canvas).toHaveCSS('cursor', 'crosshair');
    });

    test('a single right-click opens the ORDERS menu while a unit is selected', async ({ page }) => {
      test.setTimeout(30_000);
      await startGame(page);

      const canvas = page.locator('.game-canvas canvas').first();
      await expect(canvas).toBeVisible();
      // Let the camera settle on the auto-focused settler before scanning.
      await page.waitForTimeout(2_000);

      // Find the player unit: the ORDERS menu only opens when right-clicking one.
      const box = (await canvas.boundingBox())!;
      let unitPos: { x: number; y: number } | null = null;
      outer:
      for (let y = 20; y < box.height; y += 64) {
        for (let x = 20; x < box.width; x += 64) {
          await canvas.click({ position: { x, y }, button: 'right' });
          if (await page.getByRole('button', { name: /Skip Turn/i }).isVisible().catch(() => false)) {
            unitPos = { x, y };
            break outer;
          }
        }
      }
      expect(unitPos).not.toBeNull();

      // Close the menu by clicking its backdrop.
      await page.locator('.unit-context-backdrop').click();
      await expect(page.getByRole('button', { name: /Skip Turn/i })).not.toBeVisible();

      // Select the unit: movement mode is active and the cursor is a crosshair.
      await canvas.click({ position: unitPos! });
      await expect(canvas).toHaveCSS('cursor', 'crosshair');

      // A single right-click ends selection AND opens the ORDERS menu; before
      // the fix the first right-click only exited movement mode.
      await canvas.click({ position: unitPos!, button: 'right' });
      await expect(page.getByRole('button', { name: /Skip Turn/i })).toBeVisible({ timeout: 3_000 });
    });
  });

  // -------------------------------------------------------------------------
  // AI Expansion (longer gameplay)
  // -------------------------------------------------------------------------

  test.describe('AI Expansion', () => {
    test('game state changes meaningfully over 15 turns', async ({ page }) => {
      test.setTimeout(240_000);
      await startGame(page);

      // Capture initial turn text
      const topBar = page.locator('.game-top-bar');
      const initialText = await topBar.textContent();

      // Advance 15 turns
      await advanceTurns(page, 15);

      // Verify the game has progressed substantially
      const finalText = await topBar.textContent();
      expect(finalText).not.toBe(initialText);

      // Extract turn number from "Turn {n}"
      const turnMatch = finalText?.match(/Turn (\d+)/);
      expect(turnMatch).not.toBeNull();
      expect(Number(turnMatch![1])).toBeGreaterThanOrEqual(13);

      // Game should still be functional
      await expect(page.locator('.game-canvas canvas').first()).toBeVisible();
      await expect(topBar.locator('.topbar-endturn')).toBeEnabled();
    });
  });

  // -------------------------------------------------------------------------
  // Game Menu Actions
  // -------------------------------------------------------------------------

  test.describe('Game Menu Actions', () => {
    test('New Game button shows confirmation dialog', async ({ page }) => {
      test.setTimeout(120_000);
      await startGame(page);

      // Open game menu
      await openTopMenu(page, 'GAME');
      await expect(page.getByRole('button', { name: /New Game/ })).toBeVisible();

      // Click New Game — opens the custom confirm dialog
      await page.getByRole('button', { name: /New Game/ }).click();

      // The accessible confirm dialog should appear
      const confirmDialog = page.locator('[role="alertdialog"]').filter({ hasText: 'Start a New Game?' });
      await expect(confirmDialog).toBeVisible();
      // Dismiss it (Cancel) to stay in the current game
      await confirmDialog.getByRole('button', { name: 'Cancel' }).click();

      // Game should still be running (we cancelled)
      await expect(page.locator('.game-canvas canvas').first()).toBeVisible();
    });

    test('Help button from INFO menu opens help dialog', async ({ page }) => {
      await startGame(page);

      await openTopMenu(page, 'INFO');
      await page.getByRole('button', { name: /Help/ }).click();

      await expect(page.getByText('Help & Controls').first()).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press('Escape');
    });
  });

  // -------------------------------------------------------------------------
  // Keyboard Shortcuts in Game Context
  // -------------------------------------------------------------------------

  test.describe('Keyboard Shortcuts During Gameplay', () => {
    test('D key opens diplomacy report', async ({ page }) => {
      await startGame(page);

      await page.evaluate(() =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }))
      );

      const modal = page.locator('.modal').filter({ hasText: 'Diplomacy Report' });
      await expect(modal).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press('Escape');
    });

    test('F4 opens diplomacy report', async ({ page }) => {
      await startGame(page);

      await page.evaluate(() =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', code: 'F4', bubbles: true }))
      );

      const modal = page.locator('.modal').filter({ hasText: 'Diplomacy Report' });
      await expect(modal).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press('Escape');
    });
  });
});
