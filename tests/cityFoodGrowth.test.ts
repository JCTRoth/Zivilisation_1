/**
 * Regression: a size-1 city must work its FREE city centre PLUS one tile per
 * citizen. Counting the centre as a citizen's tile made a size-1 city work
 * only the centre (2 food produced vs 2 eaten), so the surplus was 0 and the
 * city never grew — exactly the "Food 2|+0, stored 0/20, 20 rounds no growth"
 * report from the City Modal.
 */
import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

function makeEngine() {
  const size = 7;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.onStateChange = null;
  e.unitTurnQueue = null;
  e.diplomacyManager = null;
  e.isPaused = true;
  e.activePlayer = 0;
  e.squareGrid = new SquareGrid(size, size);
  e.map = {
    width: size,
    height: size,
    tiles: Array.from({ length: size * size }, (_, index) => {
      const col = index % size;
      const row = Math.floor(index / size);
      return { col, row, type: TERRAIN_TYPES.GRASSLAND, terrain: TERRAIN_TYPES.GRASSLAND, resource: null, visible: true, explored: true };
    }),
  };
  const city = {
    id: 'city-1',
    name: 'Testopolis',
    civilizationId: 0,
    col: 3,
    row: 3,
    population: 1,
    buildings: [] as string[],
    specialists: [] as string[],
    workingTiles: new Set<string>(),
    userAssignedTiles: new Set<string>(),
    yields: { food: 0, production: 0, trade: 0 },
    foodStored: 0,
    foodNeeded: 20,
    tradeRoutes: [] as Array<{ trade: number }>,
  };
  const civ = {
    id: 0,
    name: 'TestCiv',
    government: 'despotism',
    technologies: [] as string[],
    resources: { food: 0, production: 0, trade: 0, science: 0, gold: 100 },
    taxRate: 50,
    scienceRate: 50,
    luxuryRate: 0,
  };
  e.cities = [city];
  e.civilizations = [civ];
  e.checkAndEndTurnIfNoMoves = () => undefined;
  return { engine: e as GameEngine, city, civ };
}

describe('City food: the free centre + one tile per citizen', () => {
  it('a size-1 city works the centre plus one tile and runs a food surplus', () => {
    const { engine, city, civ } = makeEngine();
    engine.economicManager.recomputeCityYields(city as never);

    // Centre + exactly one citizen tile.
    expect(city.workingTiles.size).toBe(2);
    // Grassland centre (2) + grassland (2) = 4 food; the citizen eats 2.
    expect(city.yields.food).toBe(4);
    const balance = engine.economicManager.cityFoodBalance(city as never, civ as never);
    expect(balance.citizenConsumption).toBe(2);
    expect(balance.surplus).toBe(2);
    expect(balance.growthThreshold).toBe(20);
  });

  it('grows within 10 turns instead of sitting at 0/20 forever', () => {
    const { engine, city, civ } = makeEngine();
    // Drive the same per-turn pipeline the game uses: recompute yields, then
    // the growth phase (TurnManager.processCityGrowth).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processGrowth = (engine.roundManager as any).processCityGrowth.bind(engine.roundManager);

    let turns = 0;
    while (city.population < 2 && turns < 20) {
      engine.economicManager.recomputeCityYields(city as never);
      processGrowth(city, false);
      turns++;
    }

    expect(turns).toBeLessThanOrEqual(10); // 20 food at +2/turn
    expect(city.population).toBe(2);
    expect(engine.economicManager.cityFoodBalance(city as never, civ as never).storage).toBeGreaterThanOrEqual(0);
  });

  it('a Granary halves the food box on growth', () => {
    const { engine, city } = makeEngine();
    city.buildings.push('granary');
    city.population = 1;
    city.foodStored = 20;
    city.foodNeeded = 20;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processGrowth = (engine.roundManager as any).processCityGrowth.bind(engine.roundManager);
    engine.economicManager.recomputeCityYields(city as never);

    processGrowth(city, false);

    expect(city.population).toBe(2);
    // 20 stored + 2 surplus = 22 → granary keeps floor(22 / 2) = 11.
    expect(city.foodStored).toBe(11);
  });
});
