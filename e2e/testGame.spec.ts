import { test, expect, Page } from '@playwright/test';

/**
 * A real test game: a Computer-vs-Computer match played in the browser, then
 * the LIVE game state read back out of the page and judged.
 *
 * The headless suite (tests/lateGameEconomics.test.ts) proves the same
 * invariants against the engine directly, which is fast and precise. This spec
 * is the other half: it proves the real application — the same code path a
 * player sees, through the UI, at whatever speed the game runs — reaches a
 * sane late game and does not fall over on the way.
 *
 * It reads `window.__gameEngine` (exposed by App.tsx) rather than scraping the
 * DOM, so the assertions are about the simulation and not about the rendering.
 */

/** Everything we need out of the running game, in one serialisable blob. */
interface GameSnapshot {
  round: number;
  year: number;
  cities: Array<{
    name: string;
    civ: number;
    buildings: string[];
    disorder: boolean;
    tax: number;
    science: number;
  }>;
  civs: Array<{ id: number; gold: number; isHuman: boolean }>;
}

async function readGame(page: Page): Promise<GameSnapshot> {
  return page.evaluate(() => {
    // Only the fields this test asserts on, so the shape of the test cannot
    // silently drift into depending on something that is not here.
    interface CityLike {
      name: string;
      civilizationId: number;
      buildings?: Array<string | { id?: string; type?: string }>;
      disorder?: boolean;
      tax?: number;
      science?: number;
    }
    interface CivLike {
      id: number;
      isHuman?: boolean;
      resources?: { gold?: number };
    }
    interface EngineLike {
      currentTurn?: number;
      currentYear?: number;
      cities?: CityLike[];
      civilizations?: CivLike[];
    }

    const engine = (window as unknown as { __gameEngine?: EngineLike }).__gameEngine;
    if (!engine) throw new Error('window.__gameEngine is not exposed');
    const id = (b: string | { id?: string; type?: string }): string =>
      typeof b === 'string' ? b : b.id ?? b.type ?? '';
    return {
      round: engine.currentTurn ?? 0,
      year: engine.currentYear ?? 0,
      cities: (engine.cities ?? []).map(c => ({
        name: c.name,
        civ: c.civilizationId,
        buildings: (c.buildings ?? []).map(id),
        disorder: c.disorder === true,
        tax: Math.round(c.tax ?? 0),
        science: Math.round(c.science ?? 0),
      })),
      civs: (engine.civilizations ?? []).map(c => ({
        id: c.id,
        gold: Math.round(c.resources?.gold ?? 0),
        isHuman: c.isHuman === true,
      })),
    };
  });
}

/** Start a fully automatic game (no human input needed) and wait for the board. */
async function startAIVsAIGame(page: Page): Promise<void> {
  // The app autosaves and restores on load, so without this a "new" game is
  // really the last run's leftovers and every assertion below is measuring
  // somebody else's empire.
  await page.addInitScript(() => {
    try { window.localStorage.clear(); } catch { /* private mode */ }
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('h2.modal-title')).toContainText('Zivilisation 1', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Next →' }).click();
  await expect(page.getByText('Fine-tune Your Challenge')).toBeVisible();
  await page.locator('select.setup-setting__control').last().selectOption('AI_VS_AI');
  await page.getByRole('button', { name: '🏛️ Start Game' }).click();
  await expect(page.locator('.game-canvas canvas').first()).toBeVisible({ timeout: 30_000 });
}

/** How many copies of `type` this city holds. */
const copies = (buildings: string[], type: string): number =>
  buildings.filter(b => b === type).length;

const HAPPINESS_BUILDINGS = ['temple', 'colosseum', 'cathedral', 'hospital'];

test.describe('test game: a browser match that reaches a sane late game', () => {
  // One test, one game. Splitting this in two let the autosave leak the first
  // test's empire into the second, so the second asserted against a game that
  // had been running before it started.
  test.describe.configure({ mode: 'serial' });

  test('plays itself into the late game, obeying the building caps throughout', async ({ page }) => {
    test.setTimeout(420_000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));

    await startAIVsAIGame(page);

    // Turn the speed up so a real game reaches its late game inside the budget.
    for (let i = 0; i < 8; i++) {
      const faster = page.getByRole('button', { name: 'Faster' });
      if (await faster.count() && await faster.first().isEnabled().catch(() => false)) {
        await faster.first().click().catch(() => {});
      }
    }

    const checkCaps = (snapshot: GameSnapshot, when: string) => {
      for (const city of snapshot.cities) {
        // The bug the coordinator exists for: six Marketplaces in one city,
        // each bought as if it were the first.
        for (const type of ['courthouse', 'aqueduct', 'bank', 'factory', 'colosseum',
          'stock_exchange', 'hydro_plant', 'power_plant', 'mass_transit',
          'recycling_center', 'marketplace', 'library', 'university']) {
          expect(copies(city.buildings, type), `${type} x${copies(city.buildings, type)} in ${city.name} ${when}`)
            .toBeLessThanOrEqual(1);
        }
        const happiness = city.buildings.filter(b => HAPPINESS_BUILDINGS.includes(b)).length;
        expect(happiness, `happiness buildings in ${city.name} ${when}`)
          .toBeLessThanOrEqual(4);
      }
    };

    // 1. First real cities. The wizard generates a RANDOM map each session, so
    // how fast an empire expands varies between runs; wait only for the first
    // cities and leave the growth trajectory to the pinned-seed headless suite
    // (tests/lateGameEconomics.test.ts), which is deterministic.
    await expect
      .poll(async () => (await readGame(page)).cities.length, { timeout: 240_000, intervals: [2_000] })
      .toBeGreaterThanOrEqual(1);

    const early = await readGame(page);
    checkCaps(early, `at round ${early.round}`);
    expect(early.round).toBeGreaterThan(1);

    // 2. Deep into the game, with the caps still holding.
    await expect
      .poll(async () => (await readGame(page)).round, { timeout: 180_000, intervals: [3_000] })
      .toBeGreaterThan(60);

    const late = await readGame(page);
    checkCaps(late, `at round ${late.round}`);

    // Somebody is still playing. On the small Computer-vs-Computer map a
    // conquest can be over by 1954 AD, so one survivor is a legitimate outcome —
    // an empire with no cities at all is not.
    const aiIds = new Set(late.civs.filter(c => !c.isHuman).map(c => c.id));
    const civsWithCities = new Set(late.cities.filter(c => aiIds.has(c.civ)).map(c => c.civ));
    expect(civsWithCities.size).toBeGreaterThanOrEqual(1);
    // One city is the floor here, not growth: the wizard generates a random map
    // per session and a cramped start can leave a civ founding slowly for
    // minutes. The pinned-seed headless suite is where growth is measured.
    const biggest = Math.max(
      0,
      ...[...civsWithCities].map(id => late.cities.filter(c => c.civ === id).length),
    );
    expect(biggest).toBeGreaterThanOrEqual(1);

    // Disorder is a total loss of tax, science and growth, so a map that is
    // mostly in disorder is a map collecting nothing.
    const disordered = late.cities.filter(c => c.disorder).length;
    expect(disordered / late.cities.length).toBeLessThan(0.4);

    // The treasury numbers must be real. Whether they are *positive* is a
    // balance question the pinned-seed headless suite answers properly: here a
    // single young city on a cramped random map can legitimately be earning
    // nothing yet.
    const taxTotal = late.cities.reduce((sum, c) => sum + c.tax, 0);
    expect(Number.isFinite(taxTotal)).toBe(true);
    expect(taxTotal).toBeGreaterThanOrEqual(0);

    expect(errors, 'no uncaught exceptions during the game').toEqual([]);
  });
});
