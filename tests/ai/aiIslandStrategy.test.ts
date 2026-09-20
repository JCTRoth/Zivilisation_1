/**
 * AI island strategy:
 *  - ferry transport (load/unload) so land units can cross water,
 *  - island-situation detection (small / very small / alone),
 *  - colonizable-island discovery,
 *  - the colony mission (ferry a settler to a small empty island),
 *  - the AutoProduction priorities (escape ship, harbor, colony ferry).
 */
import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { AutoProduction } from '@/game/engine/AutoProduction';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

const G = TERRAIN_TYPES.GRASSLAND;
const O = TERRAIN_TYPES.OCEAN;

type Rows = string[][];

interface TestUnit {
  id: string;
  type: string;
  civilizationId: number;
  col: number;
  row: number;
  movesRemaining: number;
  health: number;
  isDefeated: boolean;
  cargoUnitId?: string | null;
  embarkedOn?: string | null;
  homeCityId?: string | null;
  isNoneUnit?: boolean;
}

function makeEngine(rows: Rows) {
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
  e.devMode = true; // everything explored — keeps the island scan simple
  e.squareGrid = new SquareGrid(width, height);
  e.map = {
    width,
    height,
    tiles: rows.flatMap((row, r) =>
      row.map((t, c) => ({ col: c, row: r, type: t, terrain: t, resource: null, visible: true, explored: true })),
    ),
  };
  e.civilizations = [{ id: 0, name: 'Islanders', technologies: ['sailing'], resources: { gold: 100 } }];
  e.cities = [];
  e.checkAndEndTurnIfNoMoves = () => undefined;
  e.initializePlayerStorage(0);
  return e as GameEngine;
}

function addUnit(e: GameEngine, unit: Partial<TestUnit> & { id: string; type: string; col: number; row: number }): TestUnit {
  const record: TestUnit = {
    civilizationId: 0,
    movesRemaining: 3,
    health: 100,
    isDefeated: false,
    cargoUnitId: null,
    embarkedOn: null,
    ...unit,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (e as any).units.push(record);
  return record;
}

function addCity(e: GameEngine, id: string, col: number, row: number, civId = 0): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (e as any).cities.push({
    id, name: id, civilizationId: civId, col, row, population: 2,
    buildings: [], buildQueue: [], currentProduction: null, tradeRoutes: [],
  });
}

// Home island (left) + small empty island (right), ocean between.
const ISLANDS: Rows = [
  [O, O, O, O, O, O, O, O, O],
  [O, O, O, O, O, O, O, O, O],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, G, G, G],
  [G, G, G, O, O, O, O, O, O],
  [G, G, G, O, O, O, O, O, O],
  [O, O, O, O, O, O, O, O, O],
  [O, O, O, O, O, O, O, O, O],
];

// ---------------------------------------------------------------------------
// Ferry transport
// ---------------------------------------------------------------------------

describe('Ferry transport', () => {
  it('loads an adjacent land unit and carries it when the ferry moves', () => {
    const e = makeEngine(ISLANDS);
    const settler = addUnit(e, { id: 'set', type: 'settler', col: 2, row: 4 });
    const ferry = addUnit(e, { id: 'fer', type: 'ferry', col: 3, row: 4 });

    expect(e.canLoadFerry(ferry.id, settler.id)).toBe(true);
    expect(e.loadFerry(ferry.id, settler.id)).toBe(true);
    expect(ferry.cargoUnitId).toBe('set');
    expect(settler.embarkedOn).toBe('fer');
    expect(settler.col).toBe(3);
    // The passenger no longer occupies the shore tile.
    expect(e.getUnitAt(2, 4)).toBeNull();
    // …and cannot act while aboard.
    expect(e.canUnitMoveTo(settler.id, 2, 4)).toBe(false);

    // The passenger travels with the ship.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ferry as any).movesRemaining = 3;
    expect(e.moveUnit(ferry.id, 3, 3).success).toBe(true);
    expect(settler.col).toBe(3);
    expect(settler.row).toBe(3);
  });

  it('ships can enter open ocean (terrain passable:false is a land rule)', () => {
    const e = makeEngine(ISLANDS);
    const ferry = addUnit(e, { id: 'fer', type: 'ferry', col: 3, row: 4 });
    expect(e.canUnitMoveTo(ferry.id, 4, 4)).toBe(true);
    expect(e.moveUnit(ferry.id, 4, 4).success).toBe(true);
    // …but a land unit still cannot.
    const warrior = addUnit(e, { id: 'war', type: 'warrior', col: 2, row: 4 });
    expect(e.canUnitMoveTo(warrior.id, 3, 4)).toBe(false);
  });

  it('a destroyed ferry takes its passenger with it', () => {
    const e = makeEngine(ISLANDS);
    const settler = addUnit(e, { id: 'set', type: 'settler', col: 2, row: 4 });
    const ferry = addUnit(e, { id: 'fer', type: 'ferry', col: 3, row: 4 });
    e.loadFerry(ferry.id, settler.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).destroyCargoOf(ferry);
    expect(settler.isDefeated).toBe(true);
  });

  it('unloads onto an adjacent free land tile', () => {
    const e = makeEngine(ISLANDS);
    const settler = addUnit(e, { id: 'set', type: 'settler', col: 2, row: 4 });
    const ferry = addUnit(e, { id: 'fer', type: 'ferry', col: 3, row: 4 });
    e.loadFerry(ferry.id, settler.id);

    // Sail to the small island's coast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ferry as any).col = 5;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ferry as any).row = 3;
    expect(e.canUnloadFerry(ferry.id, 6, 3)).toBe(true);
    expect(e.unloadFerry(ferry.id, 6, 3)).toBe(true);
    expect(settler.embarkedOn).toBeNull();
    expect(settler.col).toBe(6);
    expect(settler.row).toBe(3);
    expect(ferry.cargoUnitId).toBeNull();
    // Unloading onto water is refused.
    expect(e.canUnloadFerry(ferry.id, 5, 3)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Island detection & colonizable islands
// ---------------------------------------------------------------------------

describe('Island detection', () => {
  it('reports the civ as alone on a small island', () => {
    const e = makeEngine(ISLANDS);
    addCity(e, 'home', 1, 4, 0);
    const situation = e.getIslandSituation(0);
    expect(situation).not.toBeNull();
    expect(situation!.size).toBe(15); // 3x5 home island
    expect(situation!.isSmall).toBe(true);
    expect(situation!.isVerySmall).toBe(false);
    expect(situation!.isAlone).toBe(true);

    // An enemy city on the same island removes "alone".
    addCity(e, 'enemy', 0, 4, 1);
    expect(e.getIslandSituation(0)!.isAlone).toBe(false);
  });

  it('finds small city-free islands with a landing and a waiting tile', () => {
    const e = makeEngine(ISLANDS);
    addCity(e, 'home', 1, 4, 0);

    const islands = e.getColonizableIslands(0);
    expect(islands.length).toBe(1);
    expect(islands[0].size).toBe(9); // 3x3 right island
    // The landing tile is on the island and has adjacent ocean for the ferry.
    expect(ISLANDS[islands[0].landTile.row][islands[0].landTile.col]).toBe(G);
    expect(ISLANDS[islands[0].waterTile.row][islands[0].waterTile.col]).toBe(O);
  });
});

// ---------------------------------------------------------------------------
// Colony mission
// ---------------------------------------------------------------------------

describe('AI colony mission', () => {
  it('creates a mission, loads the settler and founds a city on the island', () => {
    const e = makeEngine(ISLANDS);
    addCity(e, 'home', 1, 4, 0);
    const settler = addUnit(e, { id: 'set', type: 'settler', col: 2, row: 4, homeCityId: 'home' });
    const ferry = addUnit(e, { id: 'fer', type: 'ferry', col: 3, row: 4 });
    const storage = e.getPlayerStorage(0)!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manager = e.aiManager as any;

    manager.updateColonyMission(e.civilizations[0], storage);
    const mission = storage.turnData.colonyMission as {
      settlerId: string; ferryId: string | null; stage: string;
      landTile: { col: number; row: number }; waterTile: { col: number; row: number };
    };
    expect(mission).toBeDefined();
    expect(mission.settlerId).toBe('set');
    expect(mission.ferryId).toBe('fer');
    expect(mission.stage).toBe('gather');

    // Ferry alongside → board.
    expect(manager.tryColonyFerryAction(ferry, mission, storage)).toBe(true);
    expect(settler.embarkedOn).toBe('fer');
    expect(mission.stage).toBe('sail');

    // Sail to the target water tile and land the settler.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ferry as any).col = mission.waterTile.col;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ferry as any).row = mission.waterTile.row;
    expect(manager.tryColonyFerryAction(ferry, mission, storage)).toBe(true);
    expect(settler.embarkedOn).toBeNull();
    expect(settler.col).toBe(mission.landTile.col);
    expect(settler.row).toBe(mission.landTile.row);
    expect(storage.turnData.colonyMission).toBeUndefined();

    // The settler can now found a city on the new island.
    expect(e.foundCityWithSettler(settler.id)).toBeTruthy();
    expect(e.cities.some((c) => c.civilizationId === 0 && c.col === settler.col && c.row === settler.row)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AutoProduction priorities
// ---------------------------------------------------------------------------

describe('AutoProduction island priorities', () => {
  const makeProductionEngine = () => {
    const city = {
      id: 'city-1', name: 'Port', civilizationId: 1, col: 1, row: 1,
      population: 3, buildings: [], specialists: [], workingTiles: new Set(['1,1']),
      currentProduction: null, autoProduction: true,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine: any = {
      civilizations: [null, { id: 1, name: 'Islanders', technologies: ['sailing'], resources: { gold: 100 } }],
      cities: [city],
      units: [],
      productionManager: {
        cityHasHarborOrCoast: () => true,
        getBuildableBuildingTypes: () => ['harbor'],
      },
      getPlayerStorage: () => ({ turnData: {} }),
      economicManager: { totalUpkeep: () => 0, cityHappiness: () => ({ disorder: false, unhappiness: 0, happiness: 2 }) },
      squareGrid: { squareDistance: () => 1 },
      roundManager: { getRoundNumber: () => 0 },
      currentYear: -500,
      gameSettings: { difficulty: 'PRINCE' },
      getCityAt: () => null,
      getUnitAt: () => null,
      map: { width: 20, height: 20 },
      getIslandSituation: () => ({ size: 8, isSmall: true, isVerySmall: true, isAlone: true }),
    };
    const auto = new AutoProduction(engine);
    return { engine, auto, city };
  };

  it('builds a ferry first as the escape ship for a tiny island', () => {
    const { auto, city } = makeProductionEngine();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ship = (auto as any).buildEscapeShipProduction(city);
    expect(ship?.itemType).toBe('ferry');
  });

  it('promotes the harbor on an isolated small island', () => {
    const { auto, city } = makeProductionEngine();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const harbor = (auto as any).buildHarborProduction(city);
    expect(harbor?.itemType).toBe('harbor');
  });

  it('builds a ferry for a colony mission that has no hull yet', () => {
    const { engine, auto, city } = makeProductionEngine();
    engine.getPlayerStorage = () => ({ turnData: { colonyMission: { settlerId: 's', ferryId: null } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ferry = (auto as any).buildColonyFerryProduction(city);
    expect(ferry?.itemType).toBe('ferry');
  });
});
