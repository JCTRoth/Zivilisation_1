/**
 * The AI's budget and the economy's disbander must be the SAME budget.
 *
 * The bug this pins: the AI sized its army against a budget that left out the
 * empire's city upkeep and its debt service, while the disbander
 * (`EconomicManager.armyBudgetFor`) charged both. The gap was exactly
 * `cityUpkeep + debtService` gold a turn, so the AI built an army that was
 * over budget from the moment it was finished — and `retireSurplusUnit`, the
 * one-unit-a-round slope, took the difference back, every round, for the rest
 * of the game. The AI was building soldiers the economy was deleting.
 *
 * The test is written on the budget, not on a long simulation: a parity
 * assertion fails the moment the two numbers drift apart, while a churn
 * assertion needs a map big enough for the empire to grow and is slow.
 */
import { describe, it, expect } from 'vitest';
import type { Unit } from '../../types/game';
import { makeEngine } from '../helpers/world';

const SEED = 4242;

/** An AI civ with `cityCount` cities, `unitCount` soldiers and a tax rate. */
async function empire(cityCount: number, unitCount: number, taxRate = 60) {
  const world = await makeEngine({
    seed: SEED,
    mapType: 'CLOSEUP_1V1',
    numberOfCivilizations: 2,
  });
  const engine = world.engine as any;

  for (let i = 0; i < cityCount; i++) {
    const spot = world.landNear(10 + i * 2, 10 + i * 2, 6);
    world.settle(`Town${i}`, spot.col, spot.row, 0, 4);
  }
  for (let i = 0; i < unitCount; i++) {
    const spot = world.landNear(12 + i, 12, 5);
    world.spawnUnit({
      id: `soldier-${i}`,
      col: spot.col,
      row: spot.row,
      type: 'legion',
      civilizationId: 0,
    });
  }
  const civ = engine.civilizations[0] as any;
  civ.taxRate = taxRate;
  return { world, engine, civ };
}

describe('AI budget parity with the disbander', () => {
  it('the AI headroom is the disbander headroom — no gap', async () => {
    const { engine, civ } = await empire(6, 4);
    const econ = engine.economicManager;

    const disbanderBudget = econ.armyBudgetFor(civ);
    const committed = econ.unitUpkeep(civ.id) + econ.queuedUnitUpkeep(civ.id);
    const disbanderHeadroom = disbanderBudget - committed;

    // The number the AI plans its next unit against.
    const builderHeadroom = econ.affordableUnitUpkeep(civ);

    expect(builderHeadroom).toBe(disbanderHeadroom);
  });

  it('the gap that used to exist is the city upkeep plus the debt service', async () => {
    const { engine, civ } = await empire(6, 4);
    const econ = engine.economicManager;

    // Six cities: three are free, so three gold a turn of city upkeep the
    // builder used to forget.
    const cityUpkeep = 3;
    const income = econ.projectedIncome(civ);
    const oldBuilderHeadroom =
      income - econ.buildingUpkeep(civ.id) - econ.unitUpkeep(civ.id) - econ.queuedUnitUpkeep(civ.id);
    const disbanderHeadroom =
      econ.armyBudgetFor(civ) - econ.unitUpkeep(civ.id) - econ.queuedUnitUpkeep(civ.id);

    expect(oldBuilderHeadroom - disbanderHeadroom).toBe(cityUpkeep);
    // And the fixed number is the one the disbander reads.
    expect(econ.affordableUnitUpkeep(civ)).toBe(disbanderHeadroom);
  });

  it('a civ at the AI army cap is NOT over the disbander budget', async () => {
    const { engine, civ } = await empire(6, 2);
    const econ = engine.economicManager;

    // Fill the army up to the cap the AI plans against.
    const cap = engine.aiEconomicManager.sustainableUnits(civ, 'legion');
    const current = engine.units.filter(
      (u: Unit) => u.civilizationId === civ.id && !u.isDefeated,
    ).length;
    const first = engine.units.find((u: Unit) => u.civilizationId === civ.id);
    for (let i = current; i < cap; i++) {
      engine.units.push({
        id: `capped-${i}`,
        type: 'legion',
        civilizationId: civ.id,
        col: first.col,
        row: first.row,
        health: 100,
        movesRemaining: 1,
        maxMoves: 1,
        attack: 1,
        defense: 1,
        maintenance: 1,
      } as unknown as Unit);
    }

    const upkeep = econ.unitUpkeep(civ.id);
    const budget = econ.armyBudgetFor(civ);

    // The whole point: an army the AI deliberately built is affordable, so the
    // slope never fires and the AI never loses a soldier it just paid for.
    expect(upkeep).toBeLessThanOrEqual(budget);
  });

  it('the AI army cap and the engine army cap agree on the same budget', async () => {
    const { engine, civ } = await empire(6, 4);
    const econ = engine.economicManager;

    const engineCap = econ.sustainableUnits(civ, 'legion');
    const aiCap = engine.aiEconomicManager.sustainableUnits(civ, 'legion');

    // Both are TOTAL army sizes, both priced the same way, and both derived
    // from the economy's real budget — the AI's adds its reserve on top, so it
    // is the stricter of the two and never the looser.
    expect(aiCap).toBeLessThanOrEqual(engineCap);
  });

  it('the preview predicts what the turn actually banks', async () => {
    const { engine, civ } = await empire(3, 2, 60);
    const econ = engine.economicManager;

    // A taxman on the city: 2 gold a turn that the preview used to forget.
    const city = engine.cities.find((c: any) => c.civilizationId === civ.id);
    city.specialists = ['taxman'];

    const preview = econ.previewEconomy(civ, {
      tax: civ.taxRate,
      science: civ.scienceRate,
      luxury: civ.luxuryRate,
    });

    const before = civ.resources.gold;
    econ.processTurn(civ);
    const banked = civ.resources.gold - before;

    // The preview is the AI's budget prediction, so it has to match the turn
    // it predicts. One gold of slack for the treasury's round-up.
    expect(Math.abs(banked - preview.net)).toBeLessThanOrEqual(1);
  });

  it('the preview charges the debt service', async () => {
    const { engine, civ } = await empire(3, 2, 60);
    const econ = engine.economicManager;
    civ.debt = 100;

    const preview = econ.previewEconomy(civ, {
      tax: civ.taxRate,
      science: civ.scienceRate,
      luxury: civ.luxuryRate,
    });

    // Two gold a turn into the loan (1 per 50 debt).
    expect(preview.debtService).toBe(2);
    expect(preview.net).toBe(preview.tax - preview.upkeep - 2);
  });
});
