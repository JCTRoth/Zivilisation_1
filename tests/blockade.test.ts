/**
 * Blockade: a foreign unit standing on a city's field takes it out of
 * production, and a bigger city bleeds faster.
 *
 * The blockade decides how much food a city LOSES; Civ 1's flat 2-per-citizen
 * demand decides how fast it eats what is left. A test that only checked "the
 * tile is skipped" would pass even if the food model still fed a size-12 city
 * for free.
 */
import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { CITIZEN_FOOD_DEMAND_PER_CITIZEN } from '@/game/engine/EconomicManager';
import type { City, Unit } from '../types/game';
import { makeGridEngine, world } from './helpers/world';

const G = 'grassland';

/** A throwaway engine, for tests that only need a civ to price food against. */
function engine0(): GameEngine {
  return makeEngine();
}

/** A city object of a given size, for the pure demand checks. */
function cityOf(population: number): City {
  return { id: 'c', name: 'c', civilizationId: 0, col: 0, row: 0, population, yields: { food: 0, production: 0, trade: 0 } } as unknown as City;
}

/** The shared grid fixture, so these tests cannot drift from the rest of the suite. */
function makeEngine(): GameEngine {
  const row = [G, G, G, G, G];
  return makeGridEngine([row, [...row], [...row], [...row], [...row]]);
}

/** A settler parked on a tile, which is what a blockade looks like. */
function occupy(engine: GameEngine, col: number, row: number, civilizationId = 1): Unit {
  const unit = {
    id: `blocker-${col}-${row}`,
    type: 'phalanx',
    civilizationId,
    col,
    row,
    health: 100,
    attack: 2,
    defense: 2,
    movesRemaining: 0,
    isDefeated: false,
  } as unknown as Unit;
  engine.units.push(unit);
  return unit;
}

describe('the Civ 1 growth rule', () => {
  it('charges every citizen a flat 2 food, at every city size', () => {
    expect(CITIZEN_FOOD_DEMAND_PER_CITIZEN).toBe(2);
    for (const population of [1, 4, 5, 6, 12, 30]) {
      const civ = { ...engine0().civilizations[0] };
      const balance = engine0().economicManager!.cityFoodBalance(
        cityOf(population),
        civ as never,
      );
      expect(balance.citizenConsumption).toBe(population * 2);
    }
  });

  it('has no appetite ramp above size 5', () => {
    // A size-6 citizen eats exactly what a size-5 one does. This is the
    // explicit guard against reintroducing a per-size surcharge.
    const city = cityOf(6);
    const civ = engine0().civilizations[0] as never;
    expect(engine0().economicManager!.cityFoodBalance(city, civ).citizenConsumption)
      .toBe(12);
  });

  it('grows at (population + 1) x 10, which is Civ 1', () => {
    // Size 1 needs 20, size 5 needs 60 — the Civ 1 thresholds.
    const thresholdFor = (population: number) => (population + 1) * 10;
    expect(thresholdFor(1)).toBe(20);
    expect(thresholdFor(5)).toBe(60);
    expect(thresholdFor(11)).toBe(120);

    const engine = makeEngine();
    const city = world(engine).settle('Town', 2, 2, 0, 5) as City;
    city.population = 5;
    // Break even exactly, so the turn neither grows nor starves and the
    // threshold it is measured against is the one for size 5.
    city.yields = { food: 5 * 2, production: 2, trade: 2 };
    city.foodStored = 0;
    (engine.turnManager as unknown as {
      processCityGrowth: (c: City, d?: boolean) => void;
    }).processCityGrowth(city);

    expect(city.population).toBe(5);
    expect(city.foodNeeded).toBe(thresholdFor(5));
  });
});

describe('a foreign unit takes a city tile out of production', () => {
  it('skips a blocked tile when assigning workers', () => {
    const engine = makeEngine();
    const w = world(engine);
    const city = w.settle('Town', 2, 2, 0, 4);
    const econ = engine.economicManager!;

    econ.recomputeCityYields(city);
    const before = new Set(city.workingTiles);

    // Blockade one of the fields the city actually works.
    const [key] = Array.from(before).filter(k => k !== `${city.col},${city.row}`);
    const [col, row] = key.split(',').map(Number);
    occupy(engine, col, row);

    econ.recomputeCityYields(city);

    expect(city.workingTiles!.has(key)).toBe(false);
  });

  it('hands the tile back the moment the unit leaves', () => {
    const engine = makeEngine();
    const w = world(engine);
    const city = w.settle('Town', 2, 2, 0, 4);
    const econ = engine.economicManager!;

    econ.recomputeCityYields(city);
    const [key] = Array.from(city.workingTiles!).filter(k => k !== `${city.col},${city.row}`);
    const [col, row] = key.split(',').map(Number);

    const blocker = occupy(engine, col, row);
    econ.recomputeCityYields(city);
    expect(city.workingTiles!.has(key)).toBe(false);

    // Withdraw.
    engine.units = engine.units.filter(u => u.id !== blocker.id);
    econ.recomputeCityYields(city);
    expect(city.workingTiles!.has(key)).toBe(true);
  });

  it('does not let the city work its own units’ tiles away', () => {
    const engine = makeEngine();
    const w = world(engine);
    const city = w.settle('Town', 2, 2, 0, 4);
    const econ = engine.economicManager!;

    econ.recomputeCityYields(city);
    const [key] = Array.from(city.workingTiles!).filter(k => k !== `${city.col},${city.row}`);
    const [col, row] = key.split(',').map(Number);

    // Same civilization: a garrison or a builder is not a blockade.
    occupy(engine, col, row, 0);
    econ.recomputeCityYields(city);
    expect(city.workingTiles!.has(key)).toBe(true);
  });

  it('never offers or accepts a blocked tile', () => {
    const engine = makeEngine();
    const w = world(engine);
    const city = w.settle('Town', 2, 2, 0, 4);
    const econ = engine.economicManager!;
    econ.recomputeCityYields(city);

    const workable = econ.getWorkableTiles(city);
    const target = workable[0];
    expect(target).toBeDefined();
    expect(econ.canWorkTile(city, target.col, target.row)).toBe(true);

    occupy(engine, target.col, target.row);

    expect(econ.canWorkTile(city, target.col, target.row)).toBe(false);
    expect(econ.getWorkableTiles(city).some(t => t.col === target.col && t.row === target.row))
      .toBe(false);
  });

  it('stops a manually assigned tile paying the moment it is occupied', () => {
    const engine = makeEngine();
    const w = world(engine);
    const city = w.settle('Town', 2, 2, 0, 4) as City;
    const econ = engine.economicManager!;
    econ.recomputeCityYields(city);

    const [key] = Array.from(city.workingTiles!).filter(k => k !== `${city.col},${city.row}`);
    const [col, row] = key.split(',').map(Number);
    city.userAssignedTiles = new Set([key]);

    // The player keeps working the tile (refresh does NOT re-pick), so the
    // blockade has to be what stops it paying — not a re-assignment.
    econ.refreshYieldsFromWorkingTiles(city);
    const foodBefore = city.yields!.food;

    occupy(engine, col, row);
    econ.refreshYieldsFromWorkingTiles(city);

    expect(city.yields!.food).toBeLessThan(foodBefore);
    expect(city.workingTiles!.has(key)).toBe(false);
    expect(city.userAssignedTiles!.has(key)).toBe(false);
  });
});

describe('the blockade is what makes a city starve', () => {
  it('substitutes another field while spare tiles remain, so one blocker is not enough', () => {
    const engine = makeEngine();
    const city = world(engine).settle('Wide', 2, 2, 0, 4) as City;
    const econ = engine.economicManager!;
    econ.recomputeCityYields(city);

    const foodBefore = econ.cityFoodBalance(city, engine.civilizations[0]).surplus;
    const [firstField] = Array.from(city.workingTiles!)
      .filter(k => k !== `${city.col},${city.row}`)
      .map(k => k.split(',').map(Number) as [number, number]);
    occupy(engine, firstField[0], firstField[1]);
    econ.recomputeCityYields(city);

    // A city with more tiles than citizens simply works a different one, which
    // is why a blockade has to be a cordon, not a single raider.
    const foodAfter = econ.cityFoodBalance(city, engine.civilizations[0]).surplus;
    expect(foodAfter).toBeGreaterThanOrEqual(foodBefore - 1);
    expect(econ.getWorkableTiles(city).length).toBeGreaterThan(0);
  });

  it('starves the city once its fertile tiles are blockaded', () => {
    // A cordon only bites when the blocked tiles are the GOOD ones. On uniform
    // ground the city simply works different tiles, so this map gives the city
    // a narrow fertile belt (2 food) and a wide barren ring (1 food).
    const F = 'forest';      // 1 food
    const G2 = 'grassland';  // 2 food
    const engine: GameEngine = makeGridEngine([
      [F, G2, G2, G2, F],
      [F, F, F, F, F],
      [F, F, F, F, F],
      [F, F, F, F, F],
      [F, G2, G2, G2, F],
    ]);
    const city = world(engine).settle('Belt', 2, 2, 0, 4) as City;
    const econ = engine.economicManager!;
    econ.recomputeCityYields(city);

    // Comfortable before the cordon: the centre plus the fertile belt.
    const before = econ.cityFoodBalance(city, engine.civilizations[0]);
    expect(before.surplus).toBeGreaterThanOrEqual(0);

    // Take every fertile tile. The city is pushed onto the barren ring, which
    // cannot feed it even at break-even before.
    const fertile = ['1,0', '2,0', '3,0', '1,4', '2,4', '3,4'];
    for (const key of fertile) {
      const [col, row] = key.split(',').map(Number);
      expect(econ.cityTileYields(engine.getTileAt(col, row)).food).toBe(2);
      occupy(engine, col, row);
    }
    econ.recomputeCityYields(city);

    const after = econ.cityFoodBalance(city, engine.civilizations[0]);
    expect(after.produced).toBeLessThan(before.produced);
    expect(after.surplus).toBeLessThan(0);

    const popBefore = city.population;
    (engine.turnManager as unknown as {
      processCityGrowth: (c: City, d?: boolean) => void;
    }).processCityGrowth(city);
    expect(city.population).toBe(popBefore - 1);
  });

  it('charges the same rate the growth pipeline charges', () => {
    const engine = makeEngine();
    const w = world(engine);
    const city = w.settle('Town', 2, 2, 0, 10) as City;
    const econ = engine.economicManager!;
    econ.recomputeCityYields(city);

    const civ = engine.civilizations[0];
    const balance = econ.cityFoodBalance(city, civ);
    expect(balance.citizenConsumption)
      .toBe(city.population * CITIZEN_FOOD_DEMAND_PER_CITIZEN);
  });
});
