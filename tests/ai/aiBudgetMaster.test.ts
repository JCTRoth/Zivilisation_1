/**
 * The AI as a master of budget keeping and accounting.
 *
 * Pins the reconciliation contract the world-census postmortem demanded
 * (1,416 rounds, 219 units disbanded, gold frozen at 3–8 forever):
 *
 *  1. Reconciliation — when net income is negative AND the treasury is under
 *     80 gold, the rate controller stops drifting and reconciles: the rates
 *     snap toward solvency in ONE round and the freeze flag goes up.
 *  2. The downward ratchet — the tax rate may relax only while the books
 *     STILL balance at the lighter rates. The old controller drifted the tax
 *     down ten steps a round the moment a disband freed upkeep, rebuilt the
 *     oversized army, and let the disbander take it back: the 2↔4-unit seesaw.
 *  3. Hard spending caps — while reconciling, discretionary gold spending
 *     (rush-buys) is frozen and production pivots to income (trade buildings,
 *     caravans) instead of queueing a rifleman the treasury cannot feed.
 *  4. Disband prevention — a deficit left after reconciliation is covered by
 *     selling maintenance buildings (coin magnets) BEFORE the disbander may
 *     touch a single unit.
 */
import { describe, it, expect } from 'vitest';
import { AutoProduction } from '@/game/engine/AutoProduction';
import { makeEngine } from '../helpers/world';

const SEED = 9091;

/**
 * An AI civ with cities on level ground, `unitCount` legions whose upkeep
 * exceeds what a small tax rate collects, and a treasury set to `gold`.
 */
async function empire(cityCount: number, unitCount: number, taxRate: number, gold: number) {
  const world = await makeEngine({
    seed: SEED,
    mapType: 'CLOSEUP_1V1',
    numberOfCivilizations: 2,
  });
  const engine = world.engine as any;

  for (let i = 0; i < cityCount; i++) {
    const spot = world.landNear(6 + i * 2, 4, 4);
    world.settle(`Town${i}`, spot.col, spot.row, 0, 1);
  }
  // The map is 20×20; a tight grid keeps 24 legions inside it. Each legion
  // pays UNIT_MAINTENANCE (homeCityId is unset here on purpose), so a small
  // tax rate cannot cover the bill — the broken books the tests reason about.
  for (let i = 0; i < unitCount; i++) {
    const x = 2 + (i % 9);
    const y = 8 + Math.floor(i / 9) * 2;
    const spot = world.landNear(x, y, 4);
    world.spawnUnit({
      id: `soldier-${i}`,
      col: spot.col,
      row: spot.row,
      type: 'legion',
      civilizationId: 0,
    });
  }
  const civ = engine.civilizations[0] as any;
  // The budget master is an ACCOUNTANT — this harness turns its subject into
  // the AI civ the behavior belongs to (preProcessTurn, rush-buys, the
  // production funnel all read `isHuman`).
  civ.isHuman = false;
  // The income menu needs the trade techs (marketplace ← currency, caravan
  // ← trade); a start-of-game civ has none, and the probe test relies on
  // the menu being stocked.
  civ.technologies.push('currency', 'trade');
  civ.taxRate = taxRate;
  civ.scienceRate = 100 - taxRate;
  civ.luxuryRate = 0;
  civ.resources.gold = gold;
  return { world, engine, civ };
}

describe('the budget master (hard caps + reconciliation)', () => {
  it('reconciles in ONE round when net income is negative and gold is under 80', async () => {
    // Enough legions that a 40% tax rate cannot pay their upkeep.
    const { engine, civ } = await empire(2, 24, 40, 40);
    const aiEcon = engine.aiEconomicManager as any;

    // Precondition: the books ARE broken at the rates as they stand.
    expect(aiEcon.currentNet(civ)).toBeLessThan(0);
    expect(civ.resources.gold).toBe(40);
    expect(aiEcon.isReconciling(civ)).toBe(false);

    aiEcon.preProcessTurn(civ);

    // The freeze is up, the ledger counts this round...
    expect(aiEcon.isReconciling(civ)).toBe(true);
    expect(aiEcon.reconcileRounds(civ)).toBe(1);
    // ...and the rate did NOT crawl: one step took it most of the way to the
    // ceiling (the old controller moved 10-20 steps a round; 40 → ~50-70).
    expect(civ.taxRate).toBeGreaterThanOrEqual(55);
  });

  it('the downward ratchet: tax never relaxes below the books', async () => {
    // A fat treasury sits ABOVE the reserve, so the OLD controller's target
    // was tax 35 and it began drifting there immediately (10 steps a round) —
    // walking the income under the upkeep its own army had committed.
    const { engine, civ } = await empire(2, 16, 80, 500);
    const econ = engine.economicManager as any;
    const aiEcon = engine.aiEconomicManager as any;

    // Books balance at the starting (high) rate.
    expect(econ.previewEconomy(civ, econ.getRates(civ.id)).net).toBeGreaterThanOrEqual(0);
    expect(aiEcon.isReconciling(civ)).toBe(false);

    // Twelve rounds of "the treasury looks fine" temptation.
    for (let i = 0; i < 12; i++) aiEcon.preProcessTurn(civ);

    // Whatever rate it relaxed to, that rate's books still balance. The old
    // code ended near tax 35 with a negative net — an empire paying a third
    // of its bills on purpose.
    const net = econ.previewEconomy(civ, econ.getRates(civ.id)).net;
    expect(civ.taxRate).toBeGreaterThanOrEqual(65);
    expect(net).toBeGreaterThanOrEqual(0);
  });

  it('reconciling production pivots to income items instead of soldiers', async () => {
    const { engine, civ } = await empire(2, 24, 40, 40);
    const aiEcon = engine.aiEconomicManager as any;
    aiEcon.preProcessTurn(civ); // books break → freeze up

    const city = engine.cities.find((c: any) => c.civilizationId === 0) as any;
    city.autoProduction = true;
    city.buildings = []; // marketplace/stack still available
    city.currentProduction = null;
    city.yields = { trade: 4, food: 2, production: 3 };

    const ap = new AutoProduction(engine as any);
    const item = (ap as any).determineProductionItem(city, null, []) as
      { type: string; itemType: string } | null;

    // Under the freeze a peaceful city builds an income asset: a trade
    // building, or a caravan (the fastest sale a city can make). Not a
    // seventh rifleman the treasury will disband on arrival.
    expect(item).toBeTruthy();
    const isIncome =
      item!.type === 'building' && ['marketplace', 'bank', 'stock_exchange'].includes(String(item!.itemType));
    const isCaravan = item!.itemType === 'caravan';
    expect(isIncome || isCaravan).toBe(true);
  });

  it('hard spending cap: no rush-buys while the books are frozen', async () => {
    const { world, engine, civ } = await empire(2, 24, 40, 60);
    const aiEcon = engine.aiEconomicManager as any;
    aiEcon.preProcessTurn(civ); // break books → freeze
    expect(aiEcon.isReconciling(civ)).toBe(true);

    // A threatened city with a defender 2 shields from done: the old path
    // raged the cash down on it (remaining 2 × 2 gold/shield = 4).
    const city = engine.cities.find((c: any) => c.civilizationId === 0) as any;
    city.autoProduction = true;
    city.currentProduction = { type: 'unit', itemType: 'legion', cost: 20 };
    city.productionStored = 18;
    const enemySpot = world.landNear(Math.min(city.col + 2, 18), Math.min(city.row + 1, 18), 3);
    world.spawnUnit({
      id: 'raider',
      col: enemySpot.col,
      row: enemySpot.row,
      type: 'warrior',
      civilizationId: 1,
    });

    const goldBefore = civ.resources.gold;
    const storedBefore = city.productionStored;
    (new AutoProduction(engine as any) as any).evaluateGoldSpending(civ.id);

    expect(civ.resources.gold).toBe(goldBefore); // not one coin spent
    expect(city.productionStored).toBe(storedBefore);
  });

  it('disband prevention: a deficit is covered by selling maintenance buildings first', async () => {
    const { engine, civ } = await empire(2, 24, 40, -10);
    const econ = engine.economicManager as any;
    const city = engine.cities.find((c: any) => c.civilizationId === 0) as any;
    city.buildings = ['marketplace']; // the coin magnet: refund 40
    const unitsBefore = engine.units.filter((u: any) => u.civilizationId === 0).length;

    const res = econ.processTurn(civ);

    // The sale covered the hole: no unit was liquidated for wages.
    expect(res.disbanded).toBe(0);
    expect(res.retired).toBe(0);
    expect(city.buildings).not.toContain('marketplace');
    expect(civ.resources.gold).toBeGreaterThanOrEqual(0);
    expect(engine.units.filter((u: any) => u.civilizationId === 0).length).toBe(unitsBefore);
  });
});
