/**
 * AI advanced city management:
 *  - food security (famine prevention via worker re-assignment),
 *  - Taxman/Scientist policy driven by the strategy,
 *  - long-term granary plan for expanding civs,
 *  - the village risk/reward model (farther + more cities → more likely to
 *    collect the hut instead of leaving it for the barbarians).
 */
import { describe, expect, it, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { AutoProduction } from '@/game/engine/AutoProduction';
import { AI_MIN_FOOD_SURPLUS } from '@/game/engine/AI/AICityManager';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';
import {
  calculateVillageTakeChance,
  villageDecisionRoll,
  AI_VILLAGE_TAKE_MAX,
  AI_VILLAGE_TAKE_MIN,
  AI_VILLAGE_SAFE_DISTANCE,
  AI_VILLAGE_CITY_SCALE,
} from '@/data/VillageConstants';

type Rows = string[][];
const G = TERRAIN_TYPES.GRASSLAND;
const D = TERRAIN_TYPES.DESERT;
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
}

/** Minimal real-engine harness with a fully controlled map + one AI city. */
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
  // Give the engine a valid starting point for hand-authored yields.
  e.economicManager.refreshYieldsFromWorkingTiles(city as never);
  return { engine: e as GameEngine, city, civ };
}

function addResource(engine: GameEngine, col: number, row: number, resource: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tile = (engine as any).getTileAt(col, row);
  if (tile) tile.resource = resource;
}

// ---------------------------------------------------------------------------
// Food balance helper
// ---------------------------------------------------------------------------

describe('AI city management: food balance', () => {
  it('includes settler support in the balance (the settler equation)', () => {
    const { engine, city, civ } = makeEngine([
      [G, G, G],
      [G, G, G],
      [G, G, G],
    ], { population: 2, workingTiles: new Set(['2,2', '1,2']) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (engine as any).units = [{
      id: 'settler-1', type: 'settler', civilizationId: 0, col: 0, row: 0,
      homeCityId: 'city-1', isNoneUnit: false, health: 100,
    }];
    engine.economicManager.refreshYieldsFromWorkingTiles(city as never);
    const balance = engine.economicManager.cityFoodBalance(city as never, civ as never);
    expect(balance.produced).toBe(4); // center 2 + grassland 2
    expect(balance.citizenConsumption).toBe(4);
    expect(balance.settlerSupport).toBe(1);
    expect(balance.surplus).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Famine prevention
// ---------------------------------------------------------------------------

describe('AI city management: famine prevention', () => {
  it('re-assigns workers to food tiles until the surplus is stable', () => {
    // City centre + two deserts worked (0 food); fish tiles are the fix.
    const { engine, city, civ } = makeEngine([
      [O, O, O, O, O],
      [O, O, O, O, O],
      [G, G, G, D, O],
      [O, O, D, O, O],
      [O, O, O, O, O],
    ], { population: 3, workingTiles: new Set(['2,2', '3,2', '2,3']) });
    addResource(engine, 1, 1, 'Fish');
    addResource(engine, 2, 1, 'Fish');
    addResource(engine, 3, 1, 'Fish');
    engine.economicManager.refreshYieldsFromWorkingTiles(city as never);
    const before = engine.economicManager.cityFoodBalance(city as never, civ as never);
    expect(before.surplus).toBeLessThan(AI_MIN_FOOD_SURPLUS);

    engine.aiCityManager!.manageCity(city as never, civ as never, 'balanced_growth');

    const after = engine.economicManager.cityFoodBalance(city as never, civ as never);
    expect(after.surplus).toBeGreaterThanOrEqual(AI_MIN_FOOD_SURPLUS);
    // The pinned assignment protects the new food tiles from the auto-assigner.
    expect(city.userAssignedTiles.size).toBeGreaterThan(0);
    expect(engine.economicManager.cityFoodBalance(city as never, civ as never).turnsUntilStarvation).toBe(-1);
  });

  it('converts food above the cap into production without endangering growth', () => {
    // City centre + three fish tiles worked (surplus well above the cap); a
    // hills tile in the radius is a better production tile.
    const { engine, city, civ } = makeEngine([
      [O, O, O, O, O],
      [O, O, O, O, O],
      [O, TERRAIN_TYPES.PLAINS, G, O, O],
      [O, O, O, O, O],
      [O, O, O, O, O],
    ], { population: 2, workingTiles: new Set(['2,2', '1,1', '3,1', '2,1']) });
    addResource(engine, 1, 1, 'Fish');
    addResource(engine, 3, 1, 'Fish');
    addResource(engine, 2, 1, 'Fish');
    // The plains tile carries Horses (+2 production) — more valuable than the
    // surplus fish tile when food is already abundant.
    addResource(engine, 1, 2, 'Horses');
    engine.economicManager.refreshYieldsFromWorkingTiles(city as never);
    expect(engine.economicManager.cityFoodBalance(city as never, civ as never).surplus).toBeGreaterThan(4);
    const beforeProduction = city.yields.production;

    engine.aiCityManager!.manageCity(city as never, civ as never, 'balanced_growth');

    // The governor traded excess food for production (hills) and kept growth safe.
    expect(city.yields.production).toBeGreaterThan(beforeProduction);
    expect(engine.economicManager.cityFoodBalance(city as never, civ as never).surplus).toBeGreaterThanOrEqual(AI_MIN_FOOD_SURPLUS);
  });
});

// ---------------------------------------------------------------------------
// Specialists: money / science by strategy
// ---------------------------------------------------------------------------

describe('AI city management: specialist policy', () => {
  it('promotes a Scientist for a science-focused civ when food is secure', () => {
    const { engine, city, civ } = makeEngine([
      [O, O, O, O, O],
      [O, O, O, O, O],
      [O, O, G, O, O],
      [O, O, O, O, O],
      [O, O, O, O, O],
    ], {
      population: 4,
      buildings: ['temple'],
      workingTiles: new Set(['2,2', '1,1', '3,1', '2,1']),
    });
    addResource(engine, 1, 1, 'Fish');
    addResource(engine, 3, 1, 'Fish');
    addResource(engine, 2, 1, 'Fish');
    engine.economicManager.refreshYieldsFromWorkingTiles(city as never);
    expect(engine.economicManager.cityFoodBalance(city as never, civ as never).surplus).toBeGreaterThanOrEqual(3);

    engine.aiCityManager!.manageCity(city as never, civ as never, 'science_focus');

    expect(city.specialists).toContain('scientist');
  });

  it('demotes a Taxman back to a farmer when the city loses food', () => {
    const { engine, city, civ } = makeEngine([
      [G, G, G],
      [G, G, G],
      [G, G, G],
    ], { population: 3, specialists: ['taxman'], workingTiles: new Set(['2,2']) });
    engine.economicManager.refreshYieldsFromWorkingTiles(city as never);
    expect(engine.economicManager.cityFoodBalance(city as never, civ as never).surplus).toBeLessThan(1);

    engine.aiCityManager!.manageCity(city as never, civ as never, 'science_focus');

    expect(city.specialists).not.toContain('taxman');
  });
});

// ---------------------------------------------------------------------------
// Granary: long-term growth plan
// ---------------------------------------------------------------------------

describe('AI city management: granary plan', () => {
  it('recommends a Granary for an expanding civ with a stable surplus', () => {
    const { engine, city, civ } = makeEngine([
      [O, O, O, O, O],
      [O, O, O, O, O],
      [O, O, G, O, O],
      [O, O, O, O, O],
      [O, O, O, O, O],
    ], { population: 3, workingTiles: new Set(['2,2', '1,1', '3,1']) });
    addResource(engine, 1, 1, 'Fish');
    addResource(engine, 3, 1, 'Fish');
    engine.economicManager.refreshYieldsFromWorkingTiles(city as never);
    expect(engine.economicManager.cityFoodBalance(city as never, civ as never).surplus).toBeGreaterThanOrEqual(1);

    expect(engine.aiCityManager!.shouldBuildGrowthGranary(city as never, civ as never, 'early_expansion')).toBe(true);
    expect(engine.aiCityManager!.foodSecurityBuilding(city as never, civ as never, 'early_expansion')).toBe('granary');
    // Non-expansionist strategies do not chase granaries.
    expect(engine.aiCityManager!.shouldBuildGrowthGranary(city as never, civ as never, 'defensive_turtle')).toBe(false);
  });

  it('does not recommend a Granary the city already owns', () => {
    const { engine, city, civ } = makeEngine([
      [O, O, O, O, O],
      [O, O, O, O, O],
      [O, O, G, O, O],
      [O, O, O, O, O],
      [O, O, O, O, O],
    ], { population: 3, buildings: ['granary'], workingTiles: new Set(['2,2', '1,1', '3,1']) });
    addResource(engine, 1, 1, 'Fish');
    addResource(engine, 3, 1, 'Fish');
    engine.economicManager.refreshYieldsFromWorkingTiles(city as never);
    expect(engine.aiCityManager!.shouldBuildGrowthGranary(city as never, civ as never, 'balanced_growth')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AutoProduction integration (food guard + granary plan)
// ---------------------------------------------------------------------------

describe('AutoProduction food management', () => {
  const makeProductionEngine = (opts: {
    currentProduction?: { type: string; itemType: string; name: string; cost: number } | null;
    surplus: number;
    foodSecurityBuilding?: string | null;
    isFoodEmergency?: boolean;
  }) => {
    const city = {
      id: 'city-1', name: 'Testopolis', civilizationId: 1, col: 0, row: 0,
      population: 3, buildings: [], specialists: [], workingTiles: new Set(['0,0']),
      currentProduction: opts.currentProduction ?? null, autoProduction: true,
    };
    const extraCities = [2, 3, 4].map((n) => ({
      id: `city-${n}`, name: `Testopolis ${n}`, civilizationId: 1, col: n, row: n,
      population: 3, buildings: [], autoProduction: true,
    }));
    const units = [
      { id: 'def', type: 'warrior', civilizationId: 1, col: 0, row: 0, attack: 1, defense: 2 },
      { id: 's1', type: 'settler', civilizationId: 1, col: 5, row: 5 },
      { id: 's2', type: 'settler', civilizationId: 1, col: 6, row: 5 },
    ];
    const productionManager = {
      setCityProduction: vi.fn().mockReturnValue({ success: true }),
      getBuildableBuildingTypes: () => ['granary', 'temple', 'marketplace'],
    };
    const aiCityManager = {
      manageCity: vi.fn(),
      isFoodEmergency: vi.fn().mockReturnValue(opts.isFoodEmergency === true),
      foodSecurityBuilding: vi.fn().mockReturnValue(opts.foodSecurityBuilding ?? null),
      shouldBuildGrowthGranary: vi.fn().mockReturnValue(false),
    };
    const economicManager = {
      cityHappiness: () => ({ disorder: false, unhappiness: 0, happiness: 2 }),
      totalUpkeep: () => 0,
      cityFoodBalance: () => ({
        produced: 2, citizenConsumption: 6, settlerSupport: 0,
        surplus: opts.surplus, storage: 0, growthThreshold: 40,
        granaryLine: 0, hasGranary: false, turnsUntilGrowth: -1, turnsUntilStarvation: -1,
      }),
      sustainableUnits: () => 10,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine: any = {
      cities: [city, ...extraCities],
      units,
      civilizations: [null, {
        id: 1, name: 'TestCiv', technologies: ['pottery'],
        personality: { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5 },
        warWith: new Set(), resources: { gold: 100 },
      }],
      productionManager,
      economicManager,
      aiCityManager,
      getPlayerStorage: () => ({ turnData: {} }),
      squareGrid: { squareDistance: () => 1 },
      roundManager: { getRoundNumber: () => 0 },
      currentYear: -500,
      gameSettings: { difficulty: 'PRINCE' },
      getCityAt: () => null,
      getUnitAt: () => null,
      map: { width: 20, height: 20 },
      removeCurrentProduction: vi.fn(),
      autoProduction: { ensureProductionQueue: () => {} },
    };
    return { engine, city, productionManager, aiCityManager };
  };

  it('cancels settler production in a starving city', () => {
    const { engine, productionManager } = makeProductionEngine({
      currentProduction: { type: 'unit', itemType: 'settler', name: 'Settler', cost: 40 },
      surplus: -5,
      isFoodEmergency: true,
    });
    const auto = new AutoProduction(engine);
    auto.setAutoProduction('city-1');
    expect(engine.removeCurrentProduction).toHaveBeenCalledWith('city-1');
    // The city does not immediately re-pick a settler while it is starving.
    const picked = productionManager.setCityProduction.mock.calls[0]?.[1];
    if (picked) expect(picked.itemType).not.toBe('settler');
  });

  it('does not cancel non-settler production outside an emergency', () => {
    const { engine } = makeProductionEngine({
      currentProduction: { type: 'building', itemType: 'temple', name: 'Temple', cost: 40 },
      surplus: 2,
      isFoodEmergency: false,
    });
    const auto = new AutoProduction(engine);
    auto.setAutoProduction('city-1');
    expect(engine.removeCurrentProduction).not.toHaveBeenCalled();
  });

  it('builds the long-term food building chosen by the governor', () => {
    const { engine, productionManager, aiCityManager } = makeProductionEngine({
      currentProduction: null,
      surplus: 2,
      foodSecurityBuilding: 'granary',
    });
    const auto = new AutoProduction(engine);
    auto.setAutoProduction('city-1');
    expect(aiCityManager.foodSecurityBuilding).toHaveBeenCalled();
    const picked = productionManager.setCityProduction.mock.calls[0]?.[1];
    expect(picked?.itemType).toBe('granary');
  });
});

// ---------------------------------------------------------------------------
// Village risk/reward
// ---------------------------------------------------------------------------

describe('AI village risk model', () => {
  it('raises the take-chance with distance and empire size', () => {
    const nearSmall = calculateVillageTakeChance(1, 1);
    const farSmall = calculateVillageTakeChance(AI_VILLAGE_SAFE_DISTANCE, 1);
    const farBig = calculateVillageTakeChance(AI_VILLAGE_SAFE_DISTANCE, AI_VILLAGE_CITY_SCALE);

    expect(nearSmall).toBeLessThan(farSmall);
    expect(farSmall).toBeLessThan(farBig);
    expect(farBig).toBeLessThanOrEqual(AI_VILLAGE_TAKE_MAX);
    expect(calculateVillageTakeChance(0, 0)).toBeGreaterThanOrEqual(AI_VILLAGE_TAKE_MIN);
    expect(calculateVillageTakeChance(999, 999)).toBe(AI_VILLAGE_TAKE_MAX);
    expect(calculateVillageTakeChance(2, 4)).toBeGreaterThan(nearSmall);
  });

  it('rolls deterministically per (civ, tile)', () => {
    const a = villageDecisionRoll(0, 7, 7);
    expect(a).toBe(villageDecisionRoll(0, 7, 7));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(villageDecisionRoll(1, 7, 7)).not.toBe(a);
  });

  it('ignores a near hut for a small civ but takes a far hut for a big one', () => {
    const { engine } = makeEngine([
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
    ]);
    const manager = engine.aiManager as unknown as {
      shouldTakeVillage(
        civId: number,
        col: number,
        row: number,
        cities: Array<{ col: number; row: number }>,
      ): boolean;
    };
    // Find a tile whose hash roll makes the two situations differ.
    const nearChance = calculateVillageTakeChance(1, 1);
    const farChance = calculateVillageTakeChance(30, AI_VILLAGE_CITY_SCALE);
    let tile: { col: number; row: number } | null = null;
    for (let row = 0; row < 30 && !tile; row++) {
      for (let col = 0; col < 30; col++) {
        const roll = villageDecisionRoll(0, col, row);
        if (roll > nearChance + 0.05 && roll < farChance - 0.05) {
          tile = { col, row };
          break;
        }
      }
    }
    expect(tile).not.toBeNull();

    const nearCities = [{ col: tile!.col + 1, row: tile!.row }];
    const farCities = Array.from({ length: AI_VILLAGE_CITY_SCALE }, (_, i) => ({
      col: tile!.col + 10 + i,
      row: tile!.row,
    }));

    expect(manager.shouldTakeVillage(0, tile!.col, tile!.row, nearCities as never)).toBe(false);
    expect(manager.shouldTakeVillage(0, tile!.col, tile!.row, farCities as never)).toBe(true);
  });
});
