/**
 * The Civ1 size-1 settler rule, and the AI's habit of walking into it.
 *
 * A city of size 1 that finishes a settler is CONSUMED: the city disappears and
 * the settler becomes a lone unit (TurnManager.createProducedUnit →
 * destroyCityForSettler). The AI queued settlers in size-1 cities constantly,
 * so it kept eating its own cities. In one traced game the English founded
 * London at r0, lost it at r17, re-founded York at r17, lost York at r31 the
 * same way, and then lost their last settler — eliminated with zero cities in a
 * game nobody had attacked them in. Over 12 batch games (48 civs) this fix took
 * units-per-game from 9.7 to 22.3 and cities-per-game from 7.8 to 9.5.
 */
import { describe, it, expect, vi } from 'vitest';
import { AutoProduction } from '@/game/engine/AutoProduction';
import type { City, Unit } from '../../types/game';

/** Minimal engine: one AI civ, one city of the given size, no units. */
function makeEngine(population: number, opts: { isAI?: boolean; withSettler?: boolean; otherCities?: number } = {}) {
  const { isAI = true, withSettler = false, otherCities = 0 } = opts;
  const city = {
    id: 'city-1',
    name: 'Capital',
    civilizationId: 0,
    col: 5,
    row: 5,
    population,
    foodStored: 10,
    buildings: [],
    buildQueue: [],
    currentProduction: null,
    autoProduction: true,
    workingTiles: new Set(['5,5', '5,6']),
  } as unknown as City;

  const cities: City[] = [city];
  for (let i = 0; i < otherCities; i++) {
    cities.push({
      ...city,
      id: `city-${i + 2}`,
      name: `Town${i + 1}`,
      col: 8 + i,
      row: 5,
      population: 4,
    } as unknown as City);
  }

  // A garrison, so the "city has no defender" branch (which outranks settlers)
  // does not decide this test.
  const units: Unit[] = [
    {
      id: 'g1', type: 'warrior', civilizationId: 0, col: 5, row: 5, attack: 1, defense: 1, isDefeated: false,
      movesRemaining: 0,
      health: 0,
      icon: ''
    },
  ];
  if (withSettler) {
    units.push({ id: 's1', type: 'settler', civilizationId: 0, col: 6, row: 6, isDefeated: false } as unknown as Unit);
  }

  const productionManager = {
    setCityProduction: vi.fn().mockReturnValue({ success: true }),
    cityHasHarborOrCoast: () => true,
    getBuildableBuildingTypes: () => ['granary', 'temple'],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const engine: any = {
    cities,
    units,
    civilizations: [
      {
        // Indexed by civ id — the real engine has no placeholder at index 0.
        id: 0,
        name: 'TestCiv',
        isHuman: !isAI,
        isAI,
        technologies: ['pottery', 'bronze_working'],
        luxuryRate: 0,
        taxRate: 50,
        scienceRate: 50,
        resources: { gold: 100, science: 5, food: 0, production: 0, trade: 0 },
        productionProfile: 'early_expansion',
        personality: { aggression: 6, diplomacy: 5, military: 5, expansion: 9, science: 5, economy: 6 },
      },
    ],
    productionManager,
    economicManager: {
      totalUpkeep: () => 0,
      sustainableUnits: () => 20,
      // Content city: the happiness branch outranks settlers, and this test is
      // about the settler branch.
      cityHappiness: () => ({ disorder: false, unhappiness: 0, happiness: 2, luxuries: 0 }),
      specialistYields: () => ({ luxury: 0, food: 0, production: 0, trade: 0, science: 0, gold: 0 }),
    },
    getPlayerStorage: () => ({ turnData: {} }),
    squareGrid: {
      squareDistance: (a: number, b: number, c: number, d: number) =>
        Math.max(Math.abs(a - c), Math.abs(b - d)),
    },
    roundManager: { getRoundNumber: () => 10 },
    currentYear: -2000,
    gameSettings: { difficulty: 'PRINCE' },
    getCityAt: (col: number, row: number) => cities.find((c) => c.col === col && c.row === row) ?? null,
    getUnitAt: (col: number, row: number) =>
      units.find((u) => u.col === col && u.row === row) ?? null,
    getAllCities: () => cities,
    getAllUnits: () => units,
    map: { width: 20, height: 20 },
    cityFoodBalance: undefined,
  };
  // The real governor/economy calls are not under test here; keep the food
  // balance optimistic so the food guard is not what blocks the settler.
  engine.cityFoodBalance = () => ({ surplus: 10 });

  const auto = new AutoProduction(engine);
  // A comfortable food balance, so the starvation guard (a real method that
  // needs the tile/economy stack) is not what decides these cases.
  (auto as unknown as { cityFoodBalance: () => { surplus: number } }).cityFoodBalance = () => ({
    surplus: 10,
  });
  const choose = () => {
    const item = (auto as unknown as {
      determineProductionItem(c: City, t: unknown, p: string[]): { type: string; itemType?: string } | null;
    }).determineProductionItem(city, null, []);
    return item;
  };
  return { engine, auto, city, choose };
}

describe('settlers never consume an AI city', () => {
  it('a size-1 AI city with another city to lose is not told to build a settler', () => {
    // This is the shape that lost games: a fresh capital plus a second town, so
    // growing is always an option and eating a city is pure loss.
    const { choose } = makeEngine(1, { otherCities: 1 });
    expect(choose()?.itemType).not.toBe('settler');
  });

  it('a size-2 AI city may build a settler (only 1 pop is consumed)', () => {
    const { choose } = makeEngine(2, { otherCities: 1 });
    expect(choose()?.itemType).toBe('settler');
  });

  it('a lone size-1 city may build a settler as a deliberate capital move', () => {
    // Only city, no settler anywhere: refusing here would strand the civ with no
    // way to ever expand or move, so the capital move stays legal.
    const { choose } = makeEngine(1, { isAI: true, withSettler: false, otherCities: 0 });
    expect(choose()?.itemType).toBe('settler');
  });

  it('a lone size-1 city with a settler in hand still grows instead', () => {
    // The capital move is only a rescue, not a routine habit.
    const { choose } = makeEngine(1, { isAI: true, withSettler: true, otherCities: 0 });
    expect(choose()?.itemType).not.toBe('settler');
  });

  it('human cities are untouched — a player may choose the capital move', () => {
    const { choose } = makeEngine(1, { isAI: false, otherCities: 1 });
    expect(choose()?.itemType).toBe('settler');
  });
});
