/**
 * Blockade: a foreign unit standing on a city's field takes it out of
 * production, and a bigger city bleeds faster.
 *
 * These are the two halves of one siege mechanic, and they are only
 * interesting together: the blockade decides how much food a city LOSES, and
 * `citizenFoodDemand` decides how fast it eats through what is left. A test
 * that only checked "the tile is skipped" would pass even if the food model
 * still fed a size-12 city for free.
 */
import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import {
  citizenFoodDemand,
  BASE_CITIZEN_FOOD_DEMAND,
  CITY_SIZE_FOOD_DEMAND_THRESHOLD,
  CITY_SIZE_FOOD_DEMAND_STEP,
} from '@/game/engine/EconomicManager';
import type { City, Unit } from '../types/game';
import { makeGridEngine, world } from './helpers/world';

const G = 'grassland';

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

describe('citizenFoodDemand', () => {
  it('is the plain rate below the size threshold', () => {
    for (const population of [1, 2, 3, 4, 5]) {
      expect(citizenFoodDemand(population)).toBe(BASE_CITIZEN_FOOD_DEMAND);
    }
  });

  it('starts charging the appetite at size 6', () => {
    expect(citizenFoodDemand(6)).toBeCloseTo(BASE_CITIZEN_FOOD_DEMAND + CITY_SIZE_FOOD_DEMAND_STEP, 5);
  });

  it('adds 0.2 per head per size above the threshold', () => {
    expect(CITY_SIZE_FOOD_DEMAND_THRESHOLD).toBe(6);
    for (let population = 7; population <= 14; population++) {
      const expected =
        BASE_CITIZEN_FOOD_DEMAND + CITY_SIZE_FOOD_DEMAND_STEP * (population - 5);
      expect(citizenFoodDemand(population)).toBeCloseTo(expected, 5);
    }
  });

  it('rises monotonically, so a bigger city is never cheaper to feed than a small one', () => {
    let previous = citizenFoodDemand(1);
    for (let population = 2; population <= 30; population++) {
      const demand = citizenFoodDemand(population);
      expect(demand).toBeGreaterThanOrEqual(previous);
      previous = demand;
    }
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

describe('the blockade and the appetite together starve a big city faster', () => {
  it('costs a large city more turns of reserves than a small one', () => {
    const engine = makeEngine();
    const w = world(engine);
    const big = w.settle('Big', 2, 2, 0, 12) as City;
    const small = w.settle('Small', 4, 2, 0, 4) as City;
    const econ = engine.economicManager!;

    econ.recomputeCityYields(big);
    econ.recomputeCityYields(small);

    // Blockade one field of each.
    for (const city of [big, small]) {
      const [key] = Array.from(city.workingTiles!).filter(k => k !== `${city.col},${city.row}`);
      const [col, row] = key.split(',').map(Number);
      occupy(engine, col, row);
    }

    const balanceOf = (city: City, civId: number) =>
      econ.cityFoodBalance(city, engine.civilizations[civId]);

    const bigBalance = balanceOf(big, 0);
    const smallBalance = balanceOf(small, 0);

    // The same one-field blockade hurts both, but the large city eats more per
    // head, so its surplus is deeper and it starves sooner.
    expect(bigBalance.citizenConsumption).toBeGreaterThan(smallBalance.citizenConsumption);
    expect(bigBalance.surplus).toBeLessThan(smallBalance.surplus);
    expect(bigBalance.turnsUntilStarvation).toBeGreaterThanOrEqual(0);
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
      .toBeCloseTo(city.population * citizenFoodDemand(city.population), 5);
  });
});
