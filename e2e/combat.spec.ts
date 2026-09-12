import { test, expect, Page } from '@playwright/test';
import { closeResearchPrompt } from './helpers/game';

/**
 * Combat e2e — the dev-mode "battle lab".
 *
 * Instead of playing through the setup wizard, this spec loads the game with
 * `?combatlab`. That dev URL (mirroring `?quickstart`) starts a small game whose
 * map already has opposing unit pairs posed on adjacent tiles — see
 * `GameEngine.setupCombatScenario`. The spec then drives `engine.combatUnit`
 * with a pinned `Math.random`, so each prepared fight resolves deterministically
 * and the "no weak-attacker one-shots" rule is covered end-to-end.
 *
 * The prepared pairs (ids `lab_<index>_<attacker|defender>`) are:
 *   0) Scout   vs Riflemen  → a weak attacker may only wound, never overrun
 *   1) Legion  vs Warrior   → a stronger attacker overruns decisively
 *   2) Cavalry vs Archer    → another decisive overrun
 */

interface CombatUnitLike {
  id: string;
  type: string;
  civilizationId: number;
  col: number;
  row: number;
  health: number;
  attack?: number;
  defense?: number;
  movesRemaining: number;
  isDefeated?: boolean;
}

interface CombatEngineLike {
  units: CombatUnitLike[];
  combatUnit(attacker: CombatUnitLike, defender: CombatUnitLike): boolean;
}

interface BattleResult {
  defenderHealthAfter: number;
  defenderDefeated: boolean;
  attackerHealthAfter: number;
  attackerCol: number;
  attackerRow: number;
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
}

interface GameStoreLike {
  getState(): {
    units: CombatUnitLike[];
    gameState: { isGameStarted: boolean };
    actions: { focusCameraOnTile?: (col: number, row: number, keepZoom?: boolean) => void };
  };
}

interface LabState {
  isGameStarted: boolean;
  engineLabUnits: number;
  storeLabUnits: number;
  setupModalVisible: boolean;
}

/** Snapshot the parts of the live game that prove the battle lab is running. */
async function readLabState(page: Page): Promise<LabState> {
  return page.evaluate(() => {
    const store = (window as unknown as { __gameStore?: GameStoreLike }).__gameStore;
    const engineUnits = window.__gameEngine?.units ?? [];
    const state = store?.getState();
    const storeUnits = state?.units ?? [];
    return {
      isGameStarted: !!state?.gameState.isGameStarted,
      engineLabUnits: engineUnits.filter((u) => u.id.startsWith('lab_')).length,
      storeLabUnits: storeUnits.filter((u) => u.id.startsWith('lab_')).length,
      setupModalVisible: !!document.querySelector('h2.modal-title'),
    };
  });
}

/** Load the prepared battlefield (no setup-wizard navigation). */
async function startCombatLab(page: Page): Promise<void> {
  await page.goto('/?combatlab&noanim', { waitUntil: 'networkidle' });

  // A real game must be running: the nation-selection wizard must NOT be on
  // screen and the in-game top bar must be. This guards against a test passing
  // on a stale engine handle while the setup menu is actually showing.
  await expect(page.locator('h2.modal-title')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.game-top-bar')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.game-canvas canvas').first()).toBeVisible({ timeout: 30_000 });

  // Dismiss the start-of-game research prompt; otherwise it covers the board and
  // a headed run looks like "no game is happening".
  await closeResearchPrompt(page);

  // Both the engine AND the store (the UI's unit list) must hold the 3 prepared
  // pairs — i.e. the battle is really on the board, not just engine state.
  await expect
    .poll(
      async () => {
        const state = await readLabState(page);
        return state.isGameStarted && state.engineLabUnits === 6 && state.storeLabUnits === 6;
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  // Pan the camera onto the battlefield so a headed run shows the units.
  await page.evaluate(() => {
    const store = (window as unknown as { __gameStore?: GameStoreLike }).__gameStore;
    const state = store?.getState();
    const first = state?.units.find((u) => u.id.startsWith('lab_'));
    if (first) state?.actions.focusCameraOnTile?.(first.col, first.row);
  });
}

/**
 * Run one prepared fight with a pinned random roll and return the outcome.
 * `random` is chosen so that `random * (A + D) < A` decides the winner.
 */
async function fight(page: Page, index: number, random: number): Promise<BattleResult> {
  return page.evaluate(
    ({ pairIndex, roll }) => {
      const engine = window.__gameEngine as unknown as CombatEngineLike | undefined;
      if (!engine) throw new Error('__gameEngine is not available (is this a dev build?)');

      const attacker = engine.units.find((u) => u.id === `lab_${pairIndex}_attacker`);
      const defender = engine.units.find((u) => u.id === `lab_${pairIndex}_defender`);
      if (!attacker || !defender) throw new Error(`combat-lab pair ${pairIndex} was not placed`);

      const fromCol = attacker.col;
      const fromRow = attacker.row;
      const toCol = defender.col;
      const toRow = defender.row;

      // Pan the camera onto the fight so a headed run actually shows it.
      const store = (window as unknown as { __gameStore?: GameStoreLike }).__gameStore;
      store?.getState().actions.focusCameraOnTile?.(fromCol, fromRow);

      // Pin the roll for the duration of the single combat resolution.
      const originalRandom = Math.random;
      Math.random = () => roll;
      try {
        engine.combatUnit(attacker, defender);
      } finally {
        Math.random = originalRandom;
      }

      return {
        defenderHealthAfter: defender.health,
        defenderDefeated: !!defender.isDefeated,
        attackerHealthAfter: attacker.health,
        attackerCol: attacker.col,
        attackerRow: attacker.row,
        fromCol,
        fromRow,
        toCol,
        toRow,
      };
    },
    { pairIndex: index, roll: random },
  );
}

test.describe('Combat lab', () => {
  test.beforeEach(async ({ page }) => {
    await startCombatLab(page);
  });

  test('a Scout cannot run over a full-health Riflemen', async ({ page }) => {
    // roll 0 → the attacker wins the roll; its attack (0.5) is far below the
    // Riflemen's defense (5), so it may only wound it.
    const result = await fight(page, 0, 0);

    expect(result.defenderDefeated).toBe(false);
    expect(result.defenderHealthAfter).toBe(75);
    // The Scout neither advanced nor took damage.
    expect(result.attackerCol).toBe(result.fromCol);
    expect(result.attackerRow).toBe(result.fromRow);
    expect(result.attackerHealthAfter).toBe(100);
  });

  test('a stronger attacker overruns the defender and takes its tile', async ({ page }) => {
    // Legion (attack 3) vs Warrior (defense 1) on neutral terrain.
    const result = await fight(page, 1, 0);

    expect(result.defenderDefeated).toBe(true);
    expect(result.attackerCol).toBe(result.toCol);
    expect(result.attackerRow).toBe(result.toRow);
    expect(result.defenderHealthAfter).toBe(0);
  });

  test('a second unit pairing also resolves decisively', async ({ page }) => {
    // Cavalry (attack 5) vs Archer (defense 2).
    const result = await fight(page, 2, 0);

    expect(result.defenderDefeated).toBe(true);
    expect(result.attackerCol).toBe(result.toCol);
    expect(result.attackerRow).toBe(result.toRow);
  });

  test('a defending winner damages the attacker without killing it', async ({ page }) => {
    // roll 1 → the defender always wins the round. The Scout survives at 75%.
    const result = await fight(page, 0, 1);

    expect(result.defenderDefeated).toBe(false);
    expect(result.defenderHealthAfter).toBe(100);
    expect(result.attackerHealthAfter).toBe(75);
    expect(result.attackerCol).toBe(result.fromCol);
  });

  test('a destroyed defender is removed from the board', async ({ page }) => {
    await fight(page, 1, 0);

    // The engine removes the defeated unit after its short death animation;
    // the store sync (UNIT_REMOVED) drops it from the UI unit list too.
    await expect
      .poll(
        async () =>
          page.evaluate(
            () => !!window.__gameEngine!.units.find((u) => u.id === 'lab_1_defender'),
          ),
        { timeout: 6_000 },
      )
      .toBe(false);
  });
});
