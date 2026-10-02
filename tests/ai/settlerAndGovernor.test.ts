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
  const manager = new AICityManager({} as never, {} as never);
  const city = (overrides: Record<string, unknown>): City =>
    ({ population: 3, foodStored: 0, foodNeeded: 40, ...overrides }) as unknown as City;

  it('switches a mature city with a healthy food box to Commerce', () => {
    const profile = manager.aiGovernorForCity(
      city({ population: AI_COMMERCE_GOVERNOR_MIN_POP, foodStored: 80, foodNeeded: 100 }),
    );
    expect(profile.mode).toBe('commerce');
  });

  it('falls back to the food-first profile when the food box is depleted', () => {
    const profile = manager.aiGovernorForCity(
      city({ population: AI_COMMERCE_GOVERNOR_MIN_POP, foodStored: 5, foodNeeded: 100 }),
    );
    expect(profile.mode).toBe('balanced');
  });

  it('keeps small cities on the balanced profile', () => {
    const profile = manager.aiGovernorForCity(
      city({ population: AI_COMMERCE_GOVERNOR_MIN_POP - 1, foodStored: 90, foodNeeded: 100 }),
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
