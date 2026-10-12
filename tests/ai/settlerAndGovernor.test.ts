/**
 * Late-game city policy:
 *  - mature AI cities switch to the Commerce governor by default, falling
 *    back to the food-first profile when the food box runs low;
 *  - a crowded, dissatisfied city with no happiness building available sheds
 *    a citizen by producing a settler (Civ1 settler completion consumes one
 *    citizen), which is the pacification pressure valve.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import {
  AICityManager,
  AI_COMMERCE_GOVERNOR_MIN_POP,
  AI_COMMERCE_MIN_TRADE_TILE_SHARE,
  AI_COMMERCE_MIN_CITY_TRADE,
} from '@/game/engine/AI/AICityManager';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';
import type { City } from '../../types/game';

const G = TERRAIN_TYPES.GRASSLAND;

function makeEngine(rows: string[][]): GameEngine {
  const height = rows.length;
  const width = rows[0].length;
  const e = new GameEngine(null);
  const civ = {
    id: 0,
    name: 'TestCiv',
    isHuman: false,
    isAI: true,
    productionProfile: 'balanced_growth',
    // Deliberately no happiness techs: no temple/colosseum/cathedral possible.
    technologies: ['pottery'],
    resources: { gold: 200, food: 0, production: 0, trade: 0, science: 0 },
    warWith: new Set<number>(),
  };
  Object.assign(e, {
    units: [],
    cities: [],
    civilizations: [civ],
    onStateChange: null,
    unitTurnQueue: null,
    isPaused: true,
    activePlayer: 0,
    devMode: true,
    currentTurn: 1,
    squareGrid: new SquareGrid(width, height),
    map: {
      width,
      height,
      tiles: rows.flatMap((row, r) =>
        row.map((t, c) => ({ col: c, row: r, type: t, terrain: t, resource: null, visible: true, explored: true })),
      ),
    },
    checkAndEndTurnIfNoMoves: () => undefined,
  });
  (e as unknown as { initializePlayerStorage(id: number): void }).initializePlayerStorage(0);
  return e;
}

function addCity(e: GameEngine, overrides: Partial<City> = {}): City {
  const city = {
    id: 'city-1',
    name: 'Testopolis',
    civilizationId: 0,
    col: 2,
    row: 2,
    population: 6,
    production: 0,
    food: 0,
    gold: 0,
    science: 0,
    buildings: [],
    specialists: [],
    workingTiles: new Set(['2,2']),
    currentProduction: null,
    buildQueue: [],
    foodStored: 50,
    foodNeeded: 100,
    yields: { food: 3, production: 2, trade: 2 },
    ...overrides,
  } as unknown as City;
  e.cities.push(city);
  return city;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Commerce governor for mature AI cities', () => {
  /** A manager that can read the tiles the city works. */
  const managerFor = (tiles: Record<string, number>) => new AICityManager(
    { getTileAt: (col: number, row: number) => ({ col, row }) } as never,
    { cityTileYields: (t: { col: number; row: number }) => ({
      food: 1, production: 1, trade: tiles[`${t.col},${t.row}`] ?? 0,
    }) } as never,
  );
  const city = (overrides: Record<string, unknown>): City =>
    ({ population: 3, foodStored: 0, foodNeeded: 40, ...overrides }) as unknown as City;
  /** Four worked tiles, three of them producing trade. */
  const traded = { '2,2': 0, '3,2': 1, '3,3': 1, '2,3': 1 };
  const untraded = { '2,2': 0, '3,2': 0, '3,3': 0, '2,3': 0 };
  const workedTiles = new Set(Object.keys(traded));

  it('switches a mature city with a healthy food box and a trade grid to Commerce', () => {
    const profile = managerFor(traded).aiGovernorForCity(
      city({ population: AI_COMMERCE_GOVERNOR_MIN_POP, foodStored: 80, foodNeeded: 100, workingTiles: workedTiles }),
    );
    expect(profile.mode).toBe('commerce');
  });

  it('keeps a mature city with no trade tiles on the food-first profile', () => {
    // Population and a full food box used to be the whole rule, so a size-8
    // city on unworked grassland was governed for commerce: the weights handed
    // its slots to trade tiles that do not exist, the food surplus collapsed,
    // and the city stalled on the growth that earned the switch.
    const profile = managerFor(untraded).aiGovernorForCity(
      city({ population: AI_COMMERCE_GOVERNOR_MIN_POP, foodStored: 80, foodNeeded: 100, workingTiles: workedTiles }),
    );
    expect(profile.mode).toBe('balanced');
  });

  it('falls back to the food-first profile when the food box is depleted', () => {
    const profile = managerFor(traded).aiGovernorForCity(
      city({ population: AI_COMMERCE_GOVERNOR_MIN_POP, foodStored: 5, foodNeeded: 100, workingTiles: workedTiles }),
    );
    expect(profile.mode).toBe('balanced');
  });

  it('needs at least a third of the worked tiles to produce trade', () => {
    // 1 of 4 is below the bar; 1 of 3 is exactly on it.
    const few = managerFor({ '2,2': 0, '3,2': 1, '3,3': 0, '2,3': 0 });
    expect(few.aiGovernorForCity(city({
      population: AI_COMMERCE_GOVERNOR_MIN_POP, foodStored: 80, foodNeeded: 100, workingTiles: workedTiles,
    })).mode).toBe('balanced');

    const third = managerFor({ '2,2': 0, '3,2': 1, '3,3': 0 });
    expect(third.aiGovernorForCity(city({
      population: AI_COMMERCE_GOVERNOR_MIN_POP, foodStored: 80, foodNeeded: 100,
      workingTiles: new Set(['2,2', '3,2', '3,3']),
    })).mode).toBe('commerce');

    expect(AI_COMMERCE_MIN_TRADE_TILE_SHARE).toBeCloseTo(1 / 3);
    expect(AI_COMMERCE_MIN_CITY_TRADE).toBe(3);
  });

  it('keeps small cities on the balanced profile', () => {
    const profile = managerFor(traded).aiGovernorForCity(
      city({ population: AI_COMMERCE_GOVERNOR_MIN_POP - 1, foodStored: 90, foodNeeded: 100, workingTiles: workedTiles }),
    );
    expect(profile.mode).toBe('balanced');
  });
});

describe('Settler pacification of a dissatisfied city', () => {
  function prepare(): { e: GameEngine; city: City } {
    const e = makeEngine([
      [G, G, G, G, G],
      [G, G, G, G, G],
      [G, G, G, G, G],
    ]);
    const city = addCity(e, { population: 6 });
    (e.roundManager as unknown as { getRoundNumber: () => number }).getRoundNumber = () => 100;
    // Force the unhappiness state and solvency the production decision reads.
    (e.economicManager as unknown as { cityHappiness: () => unknown }).cityHappiness =
      () => ({ happiness: 0, unhappiness: 3, disorder: true });
    (e.economicManager as unknown as { previewEconomy: () => unknown }).previewEconomy =
      () => ({ commerce: 6, tax: 6, science: 0, luxury: 0, upkeep: 2, net: 4, hasCities: true });
    return { e, city };
  }

  const item = (e: GameEngine, city: City): { itemType?: string } | null =>
    (e.autoProduction as unknown as {
      determineProductionItem: (c: City, t: null, planned: string[]) => { itemType?: string } | null;
    }).determineProductionItem(city, null, []);

  it('produces a settler to shed an unhappy citizen when no happiness building exists', () => {
    const { e, city } = prepare();
    expect(item(e, city)?.itemType).toBe('settler');
  });

  it('prefers a happiness building when one is available', () => {
    const { e, city } = prepare();
    e.civilizations[0].technologies = ['pottery', 'ceremonial_burial'];
    expect(item(e, city)?.itemType).toBe('temple');
  });

  it('does not dissolve a pop-1 city to shed unhappiness', () => {
    const { e, city } = prepare();
    city.population = 1;
    expect(item(e, city)?.itemType).not.toBe('settler');
  });
});
