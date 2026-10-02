/**
 * AI trade (Caravan) and public-works (settler) decisions.
 *
 * Two systematic income levers the AI used to under-use:
 *  - Caravans delivered to the NEAREST friendly city only, and the production
 *    branch sat behind buildings behind a hard peace gate, so a profiled
 *    1,000-round game delivered zero trade routes. The delivery scorer now
 *    values routes (population × distance, foreign ×2) and only foreign cities
 *    we are at peace with are candidates.
 *  - The settler branch stopped at the expansion quota, so mature empires
 *    never paved or irrigated. `wantsPublicWorks` keeps a works corps while
 *    the era's improvement budget still has room.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';
import type { City, Unit } from '../../types/game';

const G = TERRAIN_TYPES.GRASSLAND;

interface TestCity extends City {
  tradeRoutes: Array<{ cityId: string; cityName: string; civilizationId: number; trade: number; distance: number }>;
}

function makeEngine(): GameEngine {
  const width = 20;
  const height = 20;
  const e = new GameEngine(null);
  const civ = {
    id: 0,
    name: 'Traders',
    isHuman: false,
    isAI: true,
    productionProfile: 'balanced_growth',
    technologies: Array.from({ length: 30 }, (_, i) => `tech_${i}`),
    resources: { gold: 100, food: 0, production: 0, trade: 0, science: 0 },
    warWith: new Set<number>(),
  };
  const other = {
    id: 1,
    name: 'Rivals',
    isHuman: true,
    isAI: false,
    technologies: [],
    resources: { gold: 100, food: 0, production: 0, trade: 0, science: 0 },
    warWith: new Set<number>(),
  };
  Object.assign(e, {
    units: [],
    cities: [],
    civilizations: [civ, other],
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
      tiles: Array.from({ length: width * height }, (_, i) => ({
        col: i % width,
        row: Math.floor(i / width),
        type: G,
        terrain: G,
        resource: null,
        visible: true,
        explored: true,
        improvement: null,
      })),
    },
    checkAndEndTurnIfNoMoves: () => undefined,
  });
  (e as unknown as { initializePlayerStorage(id: number): void }).initializePlayerStorage(0);
  (e as unknown as { initializePlayerStorage(id: number): void }).initializePlayerStorage(1);
  (e.roundManager as unknown as { getRoundNumber: () => number }).getRoundNumber = () => 50;
  return e;
}

function addCity(e: GameEngine, id: string, civId: number, col: number, row: number, population = 6): TestCity {
  const city: TestCity = {
    id,
    name: id,
    civilizationId: civId,
    col,
    row,
    population,
    production: 0,
    food: 0,
    gold: 0,
    science: 0,
    buildings: [],
    specialists: [],
    workingTiles: new Set([`${col},${row}`]),
    currentProduction: null,
    buildQueue: [],
    tradeRoutes: [],
    yields: { food: 3, production: 2, trade: 2 },
  } as TestCity;
  e.cities.push(city);
  return city;
}

function addCaravan(e: GameEngine, id: string, homeCityId: string, col: number, row: number): Unit {
  const unit = {
    id,
    type: 'caravan',
    civilizationId: 0,
    col,
    row,
    health: 100,
    movesRemaining: 1,
    isDefeated: false,
    homeCityId,
  } as unknown as Unit;
  e.units.push(unit);
  return unit;
}

function setKnownCity(e: GameEngine, civId: number, city: { col: number; row: number }): void {
  const storage = e.getPlayerStorage(0);
  if (!storage) throw new Error('no storage');
  const known = (storage.enemyLocations instanceof Map
    ? storage.enemyLocations
    : new Map()) as Map<number, Array<{ type: string; col: number; row: number }>>;
  known.set(civId, [{ type: 'city', col: city.col, row: city.row }]);
  storage.enemyLocations = known as never;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI caravan delivery target', () => {
  const target = (e: GameEngine, unit: Unit): { col: number; row: number } | null =>
    (e.aiManager as unknown as {
      chooseCaravanDeliveryTarget: (u: Unit) => { col: number; row: number } | null;
    }).chooseCaravanDeliveryTarget(unit);

  it('prefers a valuable foreign city at peace over a closer domestic one', () => {
    const e = makeEngine();
    const home = addCity(e, 'home', 0, 1, 1, 10);
    const domestic = addCity(e, 'near', 0, 3, 1, 3);
    const foreign = addCity(e, 'far', 1, 12, 12, 12);
    setKnownCity(e, 1, foreign);
    const caravan = addCaravan(e, 'car', home.id, 1, 1);

    const dest = target(e, caravan);
    expect(dest).toEqual({ col: foreign.col, row: foreign.row });
    expect(dest).not.toEqual({ col: domestic.col, row: domestic.row });
  });

  it('ignores a foreign city we are at war with', () => {
    const e = makeEngine();
    const home = addCity(e, 'home', 0, 1, 1, 10);
    const domestic = addCity(e, 'near', 0, 3, 1, 3);
    const foreign = addCity(e, 'far', 1, 12, 12, 12);
    setKnownCity(e, 1, foreign);
    (e.diplomacyManager as unknown as { isAtWar: () => boolean }).isAtWar = () => true;
    const caravan = addCaravan(e, 'car', home.id, 1, 1);

    const dest = target(e, caravan);
    expect(dest).toEqual({ col: domestic.col, row: domestic.row });
  });

  it('skips cities whose three trade-route slots are full', () => {
    const e = makeEngine();
    const home = addCity(e, 'home', 0, 1, 1, 10);
    const full = addCity(e, 'full', 0, 3, 1, 8);
    full.tradeRoutes = [1, 2, 3].map((n) => ({
      cityId: `r${n}`, cityName: `r${n}`, civilizationId: 0, trade: 1, distance: 2,
    }));
    const open = addCity(e, 'open', 0, 5, 5, 6);
    const caravan = addCaravan(e, 'car', home.id, 1, 1);

    expect(target(e, caravan)).toEqual({ col: open.col, row: open.row });
  });
});

describe('AI public works budget', () => {
  const wantsWorks = (e: GameEngine): boolean =>
    e.aiManager.wantsPublicWorks(0);

  it('scales the improvement ceiling with the era', () => {
    const e = makeEngine();
    for (let i = 0; i < 7; i++) addCity(e, `c${i}`, 0, 3 + i * 2, 10, 8);
    // 7 cities × 2 base × 6 era boost (30+ techs) = 84.
    expect(e.aiManager.improvementBudget(0)).toBe(84);
    expect(wantsWorks(e)).toBe(true);
  });

  it('stops asking for works once the budget is spent', () => {
    const e = makeEngine();
    addCity(e, 'cap', 0, 10, 10, 8);
    const tiles = e.map!.tiles as Array<{ col: number; row: number; improvement: string | null }>;
    for (const tile of tiles) {
      if (Math.max(Math.abs(tile.col - 10), Math.abs(tile.row - 10)) > 4) continue;
      if (tile.col === 10 && tile.row === 10) continue;
      tile.improvement = 'road';
    }
    expect(e.aiManager.countOwnImprovements(0))
      .toBeGreaterThanOrEqual(e.aiManager.improvementBudget(0));
    expect(wantsWorks(e)).toBe(false);
  });
});
