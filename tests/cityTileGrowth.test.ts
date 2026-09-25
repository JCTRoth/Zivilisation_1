/**
 * City food rules — the LIVE code path.
 *
 * This file used to test `src/game/City.ts` (a `City` class that nothing in
 * `src/` imports any more), which made it look like growth, starvation and the
 * Granary were covered while the engine's actual rules
 * (`TurnManager.processCityGrowth` + `EconomicManager.cityFoodBalance`) were
 * not. Everything below therefore drives the real engine.
 *
 * Civ1 rules being pinned:
 *  - a city of size N works one tile per citizen PLUS the free city centre
 *  - growth threshold is (population + 1) * 10
 *  - no granary: the food box empties on growth
 *  - granary: half the box is kept
 *  - foodStored below 0 starves: -1 population, box back to 0
 *  - a city that falls to 0 population is destroyed
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { makeGridEngine, useSeededRandom, world } from './helpers/world';
import type GameEngine from '@/game/engine/GameEngine';

const G = 'grassland';
const T = 'tundra';

function makeWorld(engine: GameEngine) {
  return world(engine);
}

function grid(rows: string[][]) {
  return makeGridEngine(rows);
}

const allGrass = (n = 5) => {
  const row = Array.from({ length: n }, () => G);
  return [row, [...row], [...row], [...row], [...row]];
};

/** The live growth/starvation step, called exactly as TurnManager does. */
function foodAndGrowthTurn(engine: GameEngine, civId = 0): void {
  const turnManager = engine.turnManager as unknown as {
    processCityFoodAndGrowth?: (city: unknown) => void;
    processCityGrowth?: (city: unknown) => void;
  };
  const city = engine.cities.find((c) => c.civilizationId === civId);
  if (!city) throw new Error('no city to process');
  const fn = turnManager.processCityFoodAndGrowth ?? turnManager.processCityGrowth;
  fn!.call(turnManager, city);
}

describe('City food rules (live engine)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a city of size N works one tile per citizen plus the free centre', () => {
    const engine = grid(allGrass());
    const w = makeWorld(engine);
    const city = w.settle('R', 2, 2, 0, 3);
    engine.economicManager.recomputeCityYields(city as never);

    // pop 3 → centre + 3 tiles = 4 worked tiles (the old dead-code test
    // asserted "N tiles", which is why the centre rule was easy to lose).
    expect(city.workingTiles.size).toBe(4);
    expect(city.workingTiles.has('2,2')).toBe(true); // the centre is always worked
  });

  it('the Civ1 radius has exactly 20 workable tiles around the centre', () => {
    const engine = grid(allGrass(7));
    const city = makeWorld(engine).settle('R', 3, 3, 0, 1);
    let workable = 0;
    for (let dCol = -2; dCol <= 2; dCol++) {
      for (let dRow = -2; dRow <= 2; dRow++) {
        if (engine.isTileInCityRadius(city as never, city.col + dCol, city.row + dRow)) workable++;
      }
    }
    expect(workable).toBe(20);
  });

  it('growth: threshold (pop+1)*10, and the box empties without a granary', () => {
    useSeededRandom(1);
    const engine = grid(allGrass());
    const w = makeWorld(engine);
    const city = w.settle('Grow', 2, 2, 0, 1);
    // A size-1 city on grassland works 2 tiles: 2 food each = 4 produced,
    // 2 eaten → +2/turn. Add stored food to cross the 20 threshold.
    city.workingTiles = new Set(['2,2', '1,2']);
    engine.economicManager.recomputeCityYields(city as never);
    expect(engine.economicManager.cityFoodBalance(city as never, engine.civilizations[0]).surplus)
      .toBeGreaterThan(0);

    city.foodStored = 19;
    foodAndGrowthTurn(engine);

    expect(city.population).toBe(2);
    // Civ1: the whole box is consumed on growth when there is no granary.
    expect(city.foodStored).toBe(0);
  });

  it('growth: a granary keeps half the box', () => {
    useSeededRandom(1);
    const engine = grid(allGrass());
    const w = makeWorld(engine);
    const city = w.settle('Granary', 2, 2, 0, 1);
    city.buildings = ['granary'];
    city.workingTiles = new Set(['2,2', '1,2']);
    engine.economicManager.recomputeCityYields(city as never);

    city.foodStored = 19;
    foodAndGrowthTurn(engine);

    expect(city.population).toBe(2);
    // Retained = floor(stored / 2) with the granary.
    expect(city.foodStored).toBeGreaterThan(0);
    expect(city.foodStored).toBeLessThan(20);
  });

  it('starvation: the box goes below 0 → -1 population and back to 0', () => {
    const engine = grid(allGrass());
    const w = makeWorld(engine);
    const city = w.settle('Hungry', 2, 2, 0, 3);
    // One tile only, three citizens to feed. `refresh…` keeps the layout we set
    // (recompute… would re-pick the best tiles and hide the deficit).
    city.workingTiles = new Set(['2,2']);
    engine.economicManager.refreshYieldsFromWorkingTiles(city as never);

    expect(engine.economicManager.cityFoodBalance(city as never, engine.civilizations[0]).surplus)
      .toBeLessThan(0);
    city.foodStored = 1;
    foodAndGrowthTurn(engine);

    expect(city.population).toBe(2);
    expect(city.foodStored).toBe(0);
  });

  it('a city that starves down to 0 population is destroyed', () => {
    const engine = grid(allGrass());
    const w = makeWorld(engine);
    const city = w.settle('Doomed', 2, 2, 0, 1);
    city.workingTiles = new Set(['2,2']); // 2 food, 2 eaten: break-even
    city.yields = { food: 0, production: 0, trade: 0 }; // nothing at all
    city.foodStored = 0;

    foodAndGrowthTurn(engine);

    expect(city.population).toBe(0);
    expect(engine.cities.some((c) => c.id === city.id)).toBe(false);
  });

  it('losing a citizen frees a tile (no free food from a dead worker)', () => {
    // Found by the long-run simulation: after a population loss the city kept
    // working its old tiles. Yields are counted per TILE while consumption is
    // counted per CITIZEN, so the extra tiles were free food until the next
    // recompute.
    const engine = grid(allGrass());
    const w = makeWorld(engine);
    const city = w.settle('Shrinking', 2, 2, 0, 4);
    city.workingTiles = new Set(['2,2', '1,2', '2,3', '3,2', '2,1']);
    engine.economicManager.refreshYieldsFromWorkingTiles(city as never);
    expect(city.workingTiles.size).toBe(5); // centre + one per citizen

    // A citizen dies (capture / failed assault / starvation all do this).
    city.population = 3;
    const changed = engine.economicManager.fitWorkedTilesToPopulation(city);

    expect(changed).toBe(true);
    expect(city.workingTiles.size).toBe(4); // centre + 3 citizens
    expect(city.workingTiles.has('2,2')).toBe(true); // the centre stays
  });

  it('a manual pin is never dropped when a citizen is lost', () => {
    const engine = grid(allGrass());
    const w = makeWorld(engine);
    const city = w.settle('Pinned', 2, 2, 0, 4);
    city.workingTiles = new Set(['2,2', '1,2', '2,3', '3,2', '2,1']);
    city.userAssignedTiles = new Set(['1,2']);
    engine.economicManager.refreshYieldsFromWorkingTiles(city as never);

    city.population = 3;
    engine.economicManager.fitWorkedTilesToPopulation(city);

    expect(city.workingTiles.size).toBe(4);
    expect(city.workingTiles.has('1,2')).toBe(true);
  });

  it('settler support food is counted, and costs double under republic/democracy', () => {
    const engine = grid(allGrass());
    const w = makeWorld(engine);
    const city = w.settle('Fed', 2, 2, 0, 2);
    city.workingTiles = new Set(['2,2', '1,2']);
    engine.economicManager.recomputeCityYields(city as never);
    const civ = engine.civilizations[0];

    w.spawnUnit({ id: 'settler-1', col: 1, row: 1, type: 'settler', homeCityId: city.id });

    const despotic = engine.economicManager.cityFoodBalance(city as never, civ as never);
    expect(despotic.settlerSupport).toBe(1);

    civ.government = 'republic';
    const republic = engine.economicManager.cityFoodBalance(city as never, civ as never);
    expect(republic.settlerSupport).toBe(2);
    // More mouths to feed: the surplus can only shrink.
    expect(republic.surplus).toBeLessThan(despotic.surplus);
  });

  it('food balance is measured against the tiles the city actually works', () => {
    const engine = grid([[G, T, G, T, G], [T, T, T, T, T], [G, T, G, T, G], [T, T, T, T, T], [G, T, G, T, G]]);
    const w = makeWorld(engine);
    const city = w.settle('Picker', 2, 2, 0, 2);

    // Work the tundra tiles: 1 food each.
    city.workingTiles = new Set(['2,2', '1,2', '2,3']);
    engine.economicManager.refreshYieldsFromWorkingTiles(city as never);
    const lean = engine.economicManager.cityFoodBalance(city as never, engine.civilizations[0]);

    // Work the grassland tiles instead: 2 food each.
    city.workingTiles = new Set(['2,2', '2,1', '0,2']);
    engine.economicManager.refreshYieldsFromWorkingTiles(city as never);
    const fat = engine.economicManager.cityFoodBalance(city as never, engine.civilizations[0]);

    expect(fat.surplus).toBeGreaterThan(lean.surplus);
  });
});
