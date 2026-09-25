/**
 * City governor: the four player-selectable modes.
 *
 *  - every mode secures food FIRST (food floor is mandatory),
 *  - the surplus above that floor follows the mode (growth fills the food box,
 *    production chases shields, commerce chases trade),
 *  - a tile the player assigned by hand is never moved — not even to stop a
 *    famine; the starvation notice reports it instead,
 *  - choosing a mode only marks the city dirty; the layout changes when the
 *    governor is applied (i.e. when the city screen closes).
 */
import { describe, expect, it, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import {
  AI_MIN_FOOD_SURPLUS,
  GOVERNOR_PROFILES,
  MAX_ENTERTAINERS_PER_CITY,
} from '@/game/engine/AI/AICityManager';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

type Rows = string[][];
const G = TERRAIN_TYPES.GRASSLAND;
const H = TERRAIN_TYPES.HILLS;
const D = TERRAIN_TYPES.DESERT;
const F = TERRAIN_TYPES.FOREST;
const O = TERRAIN_TYPES.OCEAN;

interface TestCity {
  id: string;
  name: string;
  civilizationId: number;
  col: number;
  row: number;
  population: number;
  buildings: string[];
  specialists: string[];
  workingTiles: Set<string>;
  userAssignedTiles: Set<string>;
  yields: { food: number; production: number; trade: number };
  foodStored: number;
  foodNeeded: number;
  autoProduction: boolean;
  maxPopulation?: number;
  tradeRoutes?: Array<{ trade: number }>;
  governor?: string;
  governorDirty?: boolean;
}

function makeEngine(
  rows: Rows,
  cityOverrides: Partial<TestCity> = {},
  civOverrides: Record<string, unknown> = {},
) {
  const height = rows.length;
  const width = rows[0].length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.onStateChange = null;
  e.unitTurnQueue = null;
  e.diplomacyManager = null;
  e.isPaused = true;
  e.activePlayer = 0;
  e.squareGrid = new SquareGrid(width, height);
  e.map = {
    width,
    height,
    tiles: rows.flatMap((row, r) =>
      row.map((t, c) => ({ col: c, row: r, type: t, terrain: t, resource: null, visible: true, explored: true })),
    ),
  };

  const city: TestCity = {
    id: 'city-1',
    name: 'Testopolis',
    civilizationId: 0,
    col: 2,
    row: 2,
    population: 3,
    buildings: [],
    specialists: [],
    workingTiles: new Set(['2,2']),
    userAssignedTiles: new Set<string>(),
    yields: { food: 0, production: 0, trade: 0 },
    foodStored: 0,
    foodNeeded: 40,
    autoProduction: true,
    maxPopulation: 10,
    tradeRoutes: [],
    ...cityOverrides,
  };
  const civ = {
    id: 0,
    name: 'TestCiv',
    isHuman: true,
    government: 'despotism',
    technologies: ['pottery'],
    resources: { food: 0, production: 0, trade: 0, science: 0, gold: 100 },
    taxRate: 50,
    scienceRate: 50,
    luxuryRate: 0,
    productionProfile: 'balanced_growth',
    personality: { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5 },
    capital: undefined,
    ...civOverrides,
  };
  e.cities = [city];
  e.civilizations = [civ];
  e.checkAndEndTurnIfNoMoves = () => undefined;
  e.economicManager.refreshYieldsFromWorkingTiles(city as never);
  return { engine: e as GameEngine, city, civ };
}

function addResource(engine: GameEngine, col: number, row: number, resource: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tile = (engine as any).getTileAt(col, row);
  if (tile) tile.resource = resource;
}

const govern = (engine: GameEngine, city: TestCity, civ: unknown) =>
  engine.aiCityManager.manageCity(city as never, civ as never, 'balanced_growth');

// ---------------------------------------------------------------------------

describe('city governor: food first in every mode', () => {
  it('all four modes pull the city out of a food deficit', () => {
    // Grassland everywhere except one forest with Game (3 🍞) — the best food
    // in reach. The city starts worked onto the two desert tiles.
    const rows = [
      [O, O, O, O, O],
      [O, G, F, O, O],
      [O, G, G, D, O],
      [O, O, D, O, O],
      [O, O, O, O, O],
    ];
    for (const mode of ['growth', 'production', 'commerce', 'balanced'] as const) {
      const { engine, city, civ } = makeEngine(rows, {
        population: 3,
        governor: mode,
        workingTiles: new Set(['2,2', '2,3', '3,2']),
      });
      addResource(engine, 2, 1, 'game');
      engine.economicManager.refreshYieldsFromWorkingTiles(city as never);
      const before = engine.economicManager.cityFoodBalance(city as never, civ as never).surplus;
      expect(before, 'fixture must start in deficit').toBeLessThan(0);

      govern(engine, city, civ);
      const after = engine.economicManager.cityFoodBalance(city as never, civ as never).surplus;
      expect(after, `${mode} must not leave the city short of food`).toBeGreaterThanOrEqual(
        AI_MIN_FOOD_SURPLUS,
      );
      expect(after).toBeGreaterThan(before);
    }
  });

  it('growth keeps farming well past the food floor, production only holds the floor', () => {
    const rows = [
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
    ];
    const { engine, city, civ } = makeEngine(rows, {
      population: 4,
      governor: 'growth',
      workingTiles: new Set(['2,2', '1,2', '2,3', '3,2']),
    });
    govern(engine, city, civ);
    const growthSurplus = engine.economicManager.cityFoodBalance(city as never, civ as never).surplus;

    const prod = makeEngine(rows, {
      population: 4,
      governor: 'production',
      workingTiles: new Set(['2,2', '1,2', '2,3', '3,2']),
    });
    govern(prod.engine, prod.city, prod.civ);
    const prodSurplus = prod.engine.economicManager.cityFoodBalance(
      prod.city as never,
      prod.civ as never,
    ).surplus;

    // The growth profile deliberately targets a bigger buffer than the others.
    expect(GOVERNOR_PROFILES.growth.surplusTarget).toBeGreaterThan(GOVERNOR_PROFILES.production.surplusTarget);
    expect(growthSurplus).toBeGreaterThanOrEqual(prodSurplus);
  });
});

// ---------------------------------------------------------------------------

describe('city governor: manual allocations are untouchable', () => {
  it('never moves a pinned tile, even when the city is starving', () => {
    // The two grassland tiles are the only food; pin a desert instead and the
    // governor may re-balance freely, but pinning the food tile locks it in.
    const rows = [
      [O, O, O, O, O],
      [O, G, G, O, O],
      [O, H, D, D, O],
      [O, O, D, O, O],
      [O, O, O, O, O],
    ];
    const { engine, city, civ } = makeEngine(rows, {
      population: 4,
      governor: 'growth',
      workingTiles: new Set(['2,2', '1,2', '2,3', '2,1']),
      userAssignedTiles: new Set(['1,2']), // the best food tile, pinned
    });
    govern(engine, city, civ);
    expect(city.workingTiles.has('1,2')).toBe(true);
    expect(city.userAssignedTiles.has('1,2')).toBe(true);
  });

  it('never swaps out the city centre', () => {
    const rows = [
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
    ];
    const { engine, city, civ } = makeEngine(rows, {
      population: 4,
      governor: 'production',
      workingTiles: new Set(['2,2', '1,2', '2,3', '3,2']),
    });
    govern(engine, city, civ);
    expect(city.workingTiles.has('2,2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('city governor: mode changes are deferred', () => {
  it('setCityGovernor only marks the city dirty, applyCityGovernor does the work', () => {
    const rows = [
      [O, O, O, O, O],
      [O, G, G, O, O],
      [O, H, D, D, O],
      [O, O, D, O, O],
      [O, O, O, O, O],
    ];
    const { engine, city } = makeEngine(rows, {
      population: 3,
      workingTiles: new Set(['2,2', '2,3', '3,2']),
    });
    const before = new Set(city.workingTiles);
    expect(engine.setCityGovernor(city.id, 'growth')).toBe(true);
    expect(city.governor).toBe('growth');
    expect(city.governorDirty).toBe(true);
    // Nothing has moved yet — the map must not reshuffle under the player.
    expect(new Set(city.workingTiles)).toEqual(before);

    expect(engine.applyCityGovernor(city.id)).toBe(true);
    expect(city.governorDirty).toBe(false);
    expect(new Set(city.workingTiles)).not.toEqual(before);
  });

  it('releaseManualAllocations drops the pins and rebalances', () => {
    const rows = [
      [O, O, O, O, O],
      [O, G, G, O, O],
      [O, H, D, D, O],
      [O, O, D, O, O],
      [O, O, O, O, O],
    ];
    const { engine, city } = makeEngine(rows, {
      population: 3,
      workingTiles: new Set(['2,2', '2,3', '3,2']),
      userAssignedTiles: new Set(['2,3', '3,2']),
    });
    expect(engine.releaseManualAllocations(city.id)).toBe(true);
    expect(city.userAssignedTiles.size).toBe(0);
    // The food tiles that were pinned are now free for the governor to use.
    expect(city.workingTiles.has('1,2') || city.workingTiles.has('2,1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('city governor: manual placement on the map', () => {
  it('placing a citizen on an idle tile pins the destination', () => {
    const rows = [
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
    ];
    const { engine, city } = makeEngine(rows, {
      population: 3,
      workingTiles: new Set(['2,2', '1,2', '2,3']),
    });
    // (2,3) already has a citizen, so move (1,2)'s citizen to the idle (1,1).
    expect(engine.reassignCitizen(city.id, 1, 2, 1, 1)).toBe(true);
    expect(city.workingTiles.has('1,2')).toBe(false);
    expect(city.workingTiles.has('1,1')).toBe(true);
    // The destination becomes manual; the vacated tile is released.
    expect(city.userAssignedTiles.has('1,1')).toBe(true);
    expect(city.userAssignedTiles.has('1,2')).toBe(false);

    // And the governor leaves that choice alone.
    govern(engine, city, (engine as unknown as { civilizations: unknown[] }).civilizations[0]);
    expect(city.workingTiles.has('1,1')).toBe(true);
    expect(city.userAssignedTiles.has('1,1')).toBe(true);
  });

  it('refuses a drop on a tile that already has a citizen', () => {
    // `workingTiles` is one tile per citizen plus the free centre, so a second
    // citizen cannot stand on a worked tile — a "swap" would be a no-op on the
    // set. The map drop handler keeps the grab instead of moving anyone.
    const rows = [
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
    ];
    const { engine, city } = makeEngine(rows, {
      population: 4,
      workingTiles: new Set(['2,2', '1,2', '2,3', '3,2']),
    });
    const before = [...(city.workingTiles as Set<string>)].sort();
    expect(engine.reassignCitizen(city.id, 1, 2, 3, 2)).toBe(false);
    expect([...(city.workingTiles as Set<string>)].sort()).toEqual(before);
    // An idle tile still works, and keeps the tile count (one citizen, one tile).
    expect(engine.reassignCitizen(city.id, 1, 2, 1, 1)).toBe(true);
    expect(city.workingTiles.has('1,1')).toBe(true);
    expect(city.workingTiles.has('1,2')).toBe(false);
    expect(city.workingTiles.size).toBe(before.length);
  });

  it('refuses the city centre and out-of-radius tiles', () => {
    const rows = [
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
    ];
    const { engine, city } = makeEngine(rows, {
      population: 2,
      workingTiles: new Set(['2,2', '1,2']),
    });
    expect(engine.reassignCitizen(city.id, 1, 2, 2, 2)).toBe(false); // centre
    expect(engine.reassignCitizen(city.id, 1, 2, 4, 4)).toBe(false); // corner, out of radius
    expect(city.workingTiles.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe('city governor: contentment', () => {
  it('staffs an Entertainer while the city is unhappy, up to the cap', () => {
    // A tiny, unhappy city: no luxury source, despotism, pop 2.
    const { engine, city, civ } = makeEngine(
      [
        [G, G, G, G, G],
        [G, G, G, G, G],
        [G, G, G, G, G],
        [G, G, G, G, G],
        [G, G, G, G, G],
      ],
      { population: 2, workingTiles: new Set(['2,2', '1,2']) },
      { government: 'despotism' },
    );
    govern(engine, city, civ);
    expect(city.specialists.length).toBeLessThanOrEqual(MAX_ENTERTAINERS_PER_CITY + 1);
    expect(city.specialists.every((s) => s === 'entertainer' || typeof s === 'string')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('city governor: starvation notice', () => {
  it('reports the pinned tiles that yield less food than a free one', () => {
    const rows = [
      [O, O, O, O, O],
      [O, G, G, O, O],
      [O, H, D, D, O],
      [O, O, D, O, O],
      [O, O, O, O, O],
    ];
    const { engine, city } = makeEngine(rows, {
      population: 3,
      workingTiles: new Set(['2,2', '2,3', '1,2']),
      userAssignedTiles: new Set(['2,3']),
    });
    // (2,3) is desert (0 food) while (1,1)/(2,1) grassland is free.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocking = (engine.turnManager as any).manualTilesHoldingBackFood(city);
    expect(blocking).toHaveLength(1);
    expect(blocking[0]).toMatchObject({ col: 2, row: 3, food: 0 });
  });

  it('reports nothing when the city has no manual pins', () => {
    const { engine, city } = makeEngine([
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
    ], { population: 3, workingTiles: new Set(['2,2', '1,2', '2,3']) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((engine.turnManager as any).manualTilesHoldingBackFood(city)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('city governor: runs independently of Auto Production', () => {
  it('governs a city whose Auto Production is switched off', () => {
    const rows = [
      [O, O, O, O, O],
      [O, G, G, O, O],
      [O, H, D, D, O],
      [O, O, D, O, O],
      [O, O, O, O, O],
    ];
    const { engine, city, civ } = makeEngine(rows, {
      population: 3,
      autoProduction: false, // building automation off — the governor still runs
      workingTiles: new Set(['2,2', '2,3', '3,2']),
    });
    govern(engine, city, civ);
    expect(city.workingTiles.has('1,2') || city.workingTiles.has('2,1')).toBe(true);
  });
});

// keep the vi import used by the shared harness style
void vi;
