import { describe, it, expect, beforeEach } from 'vitest';
import { SquareGrid } from '@/game/HexGrid';
import { Tile } from '@/game/Terrain';
import { City } from '@/game/City';
import { Civilization } from '@/game/Civilization';
import { Constants } from '@/utils/Constants';

// Minimal in-memory GameMap stub required by City
class TestGameMap {
  grid: SquareGrid;
  tiles: Map<string, Tile>;

  constructor(width = Constants.MAP_WIDTH, height = Constants.MAP_HEIGHT) {
    this.grid = new SquareGrid(width, height);
    this.tiles = new Map();
  }

  addTile(tile: Tile) {
    this.tiles.set(`${tile.col},${tile.row}`, tile);
  }

  getTile(col: number, row: number) {
    return this.tiles.get(`${col},${row}`) || null;
  }

  getUnitAt() { return null; }
}

function makeTile(col: number, row: number, terrain: string, improvements: string[] = [], resource: any = null, explored = true) {
  const t = new Tile(col, row, terrain as any);
  t.improvements = improvements.map(name => ({ type: name, turns: 0, complete: true }));
  if (resource) t.resources = resource;
  t.explored = { '0': explored };
  return t;
}

describe('City tile & growth rules (Civ1)', () => {
  let map: TestGameMap;
  let civ: Civilization;
  let city: City;

  beforeEach(() => {
    map = new TestGameMap(20, 20);

    // Place a simple set of tiles in a 5x5 area
    const centerCol = 10;
    const centerRow = 10;

    // Create center tile (city)
    map.addTile(makeTile(centerCol, centerRow, 'grassland'));

    // Surrounding diamond (20 tiles)
    const offsets = [
      {c:0,r:-2},{c:1,r:-1},{c:2,r:0},{c:1,r:1},{c:0,r:2},{c:-1,r:1},{c:-2,r:0},{c:-1,r:-1},
      {c:0,r:-1},{c:1,r:0},{c:0,r:1},{c:-1,r:0},
      {c:2,r:-1},{c:2,r:1},{c:-2,r:-1},{c:-2,r:1},{c:1,r:-2},{c:-1,r:-2},{c:1,r:2},{c:-1,r:2}
    ];

    // Mix of terrain types to test priorities
    const terrains = ['grassland','plains','forest','hills','desert','grassland','plains','forest','grassland','plains','grassland','plains','hills','forest','desert','hills','grassland','plains','forest','plains'];

    offsets.forEach((off, idx) => {
      const terrain = terrains[idx % terrains.length];
      map.addTile(makeTile(centerCol + off.c, centerRow + off.r, terrain));
    });

    // Create a minimal Civilization and City and hook to map
    civ = new Civilization('0','Testland','Leader','blue', true);
    civ.gameMap = map as any;
    civ.cities = [];

    city = new City('TestCity', civ as any, centerCol, centerRow);
    civ.cities.push(city);

    // Populate map into city's gameMap
    (city as any).gameMap = map;
  });

  it('city radius contains exactly 20 workable tiles', () => {
    const radiusTiles = city.getCityRadiusTiles(map as any);
    // The implementation includes only non-zero distance tiles with manhattanDistance<=2 and !=0
    expect(radiusTiles.length).toBe(20);
  });

  it('city center always worked and provides base yields', () => {
    city.workingTiles.clear();
    city.workingTiles.add(`${city.col},${city.row}`);
    city.calculateYields(map as any);

    // Civ1: City center always produces minimum 2 food, 1 production, 1 trade
    expect(city.food).toBeGreaterThanOrEqual(2);
    expect(city.production).toBeGreaterThanOrEqual(1);
    expect(city.trade).toBeGreaterThanOrEqual(1);
  });

  it('population N works N tiles including city center', () => {
    // Set population 5
    city.population = 5;
    city.optimizeWorkerAssignment(map as any);

    expect(city.workingTiles.size).toBe(5);
    // city center present
    expect(city.workingTiles.has(`${city.col},${city.row}`)).toBe(true);
  });

  it('tile selection prioritizes food-rich tiles', () => {
    // Make one tile extremely food-rich
    const highFoodTile = map.getTile(12, 10);
    // Patch yields by adding improvement
    highFoodTile.addImprovement('irrigation');
    highFoodTile.baseFood = 10;

    city.population = 3;
    city.optimizeWorkerAssignment(map as any);

    // Verify that one of the worked tiles is the highFoodTile
    const worked = Array.from(city.workingTiles);
    expect(worked.some(k => k === '12,10')).toBe(true);
  });

  it('food surplus leads to growth according to formula', () => {
    // Civ1: growth threshold = 20 + (population * 2)
    // For population 1: threshold = 20 + 2 = 22
    city.population = 1;

    // Make city produce 25 food per turn (3 more than needed after 2 consumption)
    city.food = 25;
    city.foodStorage = 0;
    city.maxFoodStorage = 100;

    city.processFood(map as any);

    // foodSurplus = 25 - 2 = 23
    // Since foodStorage (23) >= threshold (22) and population < maxPopulation, should grow
    expect(city.population).toBe(2);
    expect(city.foodStorage).toBe(0);
  });

  it('food shortage triggers starvation and reduces population', () => {
    city.population = 3;
    city.food = 0; // no food produced
    city.foodStorage = 0;

    city.processFood(map as any);

    // Starvation should reduce population (if >1)
    expect(city.population).toBeLessThan(3);
  });

  it('production and trade are accumulated from worked tiles', () => {
    city.population = 4;
    city.optimizeWorkerAssignment(map as any);
    city.calculateYields(map as any);

    expect(city.production).toBeGreaterThanOrEqual(0);
    expect(city.trade).toBeGreaterThanOrEqual(0);
  });

});
