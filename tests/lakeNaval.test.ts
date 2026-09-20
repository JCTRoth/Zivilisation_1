/**
 * Lake terrain + naval rules.
 *
 *  - A connected water body smaller than 4x6 (24) tiles is a LAKE: it has the
 *    fresh-water yields of a river but is NEVER passable.
 *  - Naval units may navigate rivers and enter their own coastal city, but
 *    never a lake or a landlocked city.
 *  - Naval units can only be produced in a city with a water connection
 *    (ocean access), enforced on every production path.
 *  - Landmass connectivity lets the AI tell "same continent" from "across the
 *    water" — unreachable targets are excluded until shipbuilding is possible.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { Pathfinding } from '@/game/engine/Pathfinding';
import MapGenerator, { LAKE_MAX_TILES } from '@/game/engine/MapGenerator/MapGenerator';
import { GroupKind } from '@/game/engine/MapGenerator/MapGeneratorHelper';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';

/**
 * Build a minimal GameEngine whose world is a small, fully controlled map.
 * Terrain rows use string keys ('plains', 'ocean', 'river', 'lake').
 */
function makeEngine(rows: string[][]): GameEngine {
  const height = rows.length;
  const width = rows[0].length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  e.units = [];
  e.cities = [];
  e.civilizations = [];
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
      row.map((type, c) => ({ col: c, row: r, type, terrain: type, visible: true, explored: true })),
    ),
  };
  e.checkAndEndTurnIfNoMoves = () => undefined;
  return e as GameEngine;
}

const addUnit = (e: GameEngine, id: string, type: string, col: number, row: number, civ = 0) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props = (GameEngine as any).UNIT_PROPS[type] ?? { movement: 1, attack: 1, defense: 1 };
  const unit = {
    id,
    type,
    civilizationId: civ,
    col,
    row,
    health: 100,
    hitPoints: props.hitPoints ?? 2,
    maxHitPoints: props.hitPoints ?? 2,
    movesRemaining: props.movement ?? 1,
    maxMoves: props.movement ?? 1,
    hasMovedThisTurn: false,
    attack: props.attack ?? 0,
    defense: props.defense ?? 1,
    isDefeated: false,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (e as any).units.push(unit);
  return unit;
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Map generation: lake classification
// ---------------------------------------------------------------------------

describe('Map generation: lake classification', () => {
  it('turns small enclosed water bodies into lakes and keeps big ones as ocean', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gen = new MapGenerator({ mapWidth: 20, mapHeight: 20, seed: 7 }) as any;
    for (let r = 0; r < 20; r++) {
      for (let c = 0; c < 20; c++) {
        gen.cells[r][c].type = TERRAIN_TYPES.PLAINS;
        gen.cells[r][c].terrain = TERRAIN_TYPES.PLAINS;
      }
    }

    // Small body: 2x3 = 6 tiles (< LAKE_MAX_TILES) at (1,1)-(3,2).
    for (let c = 1; c <= 3; c++) {
      for (let r = 1; r <= 2; r++) gen.cells[r][c].type = TERRAIN_TYPES.OCEAN;
    }
    // Large body: 6x5 = 30 tiles (>= LAKE_MAX_TILES) at (8,8)-(12,13).
    for (let c = 8; c <= 12; c++) {
      for (let r = 8; r <= 13; r++) gen.cells[r][c].type = TERRAIN_TYPES.OCEAN;
    }

    gen.classifyLakes();

    expect(gen.cells[1][1].type).toBe(TERRAIN_TYPES.LAKE);
    expect(gen.cells[2][3].type).toBe(TERRAIN_TYPES.LAKE);
    expect(gen.cells[8][8].type).toBe(TERRAIN_TYPES.OCEAN);
    expect(gen.cells[13][12].type).toBe(TERRAIN_TYPES.OCEAN);

    // Groups: the lake is its own group kind, the ocean stays navigable water.
    gen.stage7_FloodFillGroups();
    const lakeGroup = gen.getGroup(1, 1);
    expect(lakeGroup.kind).toBe(GroupKind.Lake);
    expect(gen.getOceans()).toHaveLength(1);
    expect(LAKE_MAX_TILES).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// Movement rules
// ---------------------------------------------------------------------------

describe('Naval movement rules', () => {
  it('lakes are impassable for both land and naval units', () => {
    const e = makeEngine([
      ['plains', 'plains', 'plains', 'plains'],
      ['plains', 'plains', 'lake', 'ocean'],
      ['plains', 'plains', 'plains', 'ocean'],
    ]);
    addUnit(e, 'w', 'warrior', 1, 1);
    addUnit(e, 'ship', 'trireme', 3, 1, 1);

    expect(e.canUnitMoveTo('w', 2, 1)).toBe(false);
    expect(e.canUnitMoveTo('ship', 2, 1)).toBe(false);
    expect(e.moveUnit('w', 2, 1).success).toBe(false);
  });

  it('naval units may navigate river tiles', () => {
    const e = makeEngine([
      ['ocean', 'river', 'plains'],
      ['ocean', 'plains', 'plains'],
      ['plains', 'plains', 'plains'],
    ]);
    addUnit(e, 'ship', 'trireme', 0, 0);
    // River is a single tile (not a wide river) and navigable for ships.
    expect(e.canUnitMoveTo('ship', 1, 0)).toBe(true);
    const result = e.moveUnit('ship', 1, 0);
    expect(result.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((e as any).units[0].col).toBe(1);
  });

  it('naval units may return to a coastal city but not enter a landlocked one', () => {
    const e = makeEngine([
      ['ocean', 'plains', 'plains', 'plains'],
      ['plains', 'plains', 'plains', 'plains'],
      ['plains', 'plains', 'plains', 'plains'],
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).cities = [
      { id: 'coastal', name: 'Coastal', civilizationId: 0, col: 1, row: 0, population: 2, buildings: [] },
      { id: 'inland', name: 'Inland', civilizationId: 0, col: 3, row: 2, population: 2, buildings: [] },
    ];
    addUnit(e, 'ship', 'trireme', 0, 0);

    expect(e.canUnitMoveTo('ship', 1, 0)).toBe(true);
    expect(e.moveUnit('ship', 1, 0).success).toBe(true);

    // From the city the ship cannot sail onto ordinary land…
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ship = (e as any).units[0];
    ship.col = 0;
    ship.row = 0;
    ship.movesRemaining = 3;
    expect(e.canUnitMoveTo('ship', 3, 2)).toBe(false);
    expect(e.canUnitMoveTo('ship', 2, 0)).toBe(false);
  });

  it('pathfinding costs: lake is always impassable, rivers are navigable', () => {
    const tile = (type: string) => ({ col: 0, row: 0, type, terrain: type, visible: true, explored: true });

    expect(Pathfinding.getMovementCost(tile('lake'), 'warrior')).toBe(Infinity);
    expect(Pathfinding.getMovementCost(tile('lake'), 'trireme')).toBe(Infinity);
    expect(Pathfinding.getMovementCost(tile('ocean'), 'warrior')).toBe(Infinity);
    expect(Pathfinding.getMovementCost(tile('river'), 'warrior')).toBeLessThan(Infinity);
    expect(Pathfinding.getMovementCost(tile('river'), 'trireme')).toBeLessThan(Infinity);
    // The Ferry (a naval unit missing from the legacy hardcoded lists) is
    // handled through UNIT_PROPERTIES.
    expect(Pathfinding.getMovementCost(tile('ocean'), 'ferry')).toBeLessThan(Infinity);
    expect(Pathfinding.getMovementCost(tile('plains'), 'ferry')).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// Naval production gating
// ---------------------------------------------------------------------------

describe('Naval production requires a water connection', () => {
  const makeCityEngine = (coastal: boolean) => {
    const e = makeEngine([
      ['ocean', 'plains', 'plains', 'plains'],
      ['plains', 'plains', 'plains', 'plains'],
      ['plains', 'plains', 'plains', 'plains'],
    ]);
    if (!coastal) {
      // Remove the only ocean tile so the map becomes landlocked.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e as any).map.tiles[0].type = 'plains';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e as any).map.tiles[0].terrain = 'plains';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e as any).map.tiles[3].type = 'plains';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e as any).map.tiles[3].terrain = 'plains';
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).civilizations = [{
      id: 0,
      technologies: ['sailing'],
      resources: { gold: 100 },
    }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).cities = [{
      id: 'city-1',
      name: 'Port',
      civilizationId: 0,
      col: 1,
      row: 1,
      population: 2,
      buildings: [],
      currentProduction: null,
      buildQueue: [],
    }];
    return e;
  };

  it('rejects a ship in a landlocked city on every production path', () => {
    const e = makeCityEngine(false);
    const result = e.productionManager.setCityProduction('city-1', {
      type: 'unit', itemType: 'sail', name: 'Sail', cost: 40,
    } as never);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_water_access');
  });

  it('allows a ship in a coastal city', () => {
    const e = makeCityEngine(true);
    const result = e.productionManager.setCityProduction('city-1', {
      type: 'unit', itemType: 'sail', name: 'Sail', cost: 40,
    } as never);
    expect(result.success).toBe(true);
  });

  it('civCanBuildShips needs both a coastal city and naval tech', () => {
    const inland = makeCityEngine(false);
    expect(inland.civCanBuildShips(0)).toBe(false);

    const coastal = makeCityEngine(true);
    expect(coastal.civCanBuildShips(0)).toBe(true);

    // No naval tech → no ships even with a coast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (coastal as any).civilizations[0].technologies = [];
    expect(coastal.civCanBuildShips(0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Landmass connectivity / naval need
// ---------------------------------------------------------------------------

describe('Landmass connectivity', () => {
  // Two 2x2 islands separated by a column of ocean.
  const twoIslands = () => makeEngine([
    ['plains', 'plains', 'ocean', 'plains', 'plains'],
    ['plains', 'plains', 'ocean', 'plains', 'plains'],
    ['ocean', 'ocean', 'ocean', 'ocean', 'ocean'],
    ['plains', 'plains', 'ocean', 'plains', 'plains'],
    ['plains', 'plains', 'ocean', 'plains', 'plains'],
  ]);

  it('detects same-continent vs across-water tiles', () => {
    const e = twoIslands();
    expect(e.areLandConnected(0, 0, 1, 1)).toBe(true);
    expect(e.areLandConnected(0, 0, 3, 3)).toBe(false);
    expect(e.areLandConnected(0, 0, 2, 0)).toBe(false); // ocean
    expect(e.getLandmassId(0, 0)).toBeGreaterThanOrEqual(0);
    expect(e.getLandmassId(2, 0)).toBe(-1);
  });

  it('knows when the civ needs a navy (known enemy on another landmass)', () => {
    const e = twoIslands();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).civilizations = [{ id: 0, technologies: ['sailing'] }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).cities = [{ id: 'c', civilizationId: 0, col: 0, row: 0, population: 2 }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).initializePlayerStorage(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).playerStorage.get(0).enemyLocations.set(1, [
      { col: 3, row: 3, type: 'city', id: 'enemy-city', discoveredRound: 0, lastSeenRound: 0 },
    ]);

    expect(e.isTileReachableByLandFromCiv(0, 3, 3)).toBe(false);
    expect(e.civNeedsNavy(0)).toBe(true);

    // Put the enemy on our own landmass → no navy needed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).playerStorage.get(0).enemyLocations.set(1, [
      { col: 1, row: 1, type: 'city', id: 'enemy-city', discoveredRound: 0, lastSeenRound: 0 },
    ]);
    expect(e.civNeedsNavy(0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Wide rivers (2-3 tiles) are water gaps for land units → build a boat
// ---------------------------------------------------------------------------

describe('Wide rivers act as water gaps', () => {
  // Column 2 + 3 are a 2-tile-wide river; banks at cols 0-1 and 4-5.
  const wideRiverMap = () => makeEngine([
    ['plains', 'plains', 'river', 'river', 'plains', 'plains'],
    ['plains', 'plains', 'river', 'river', 'plains', 'plains'],
    ['plains', 'plains', 'river', 'river', 'plains', 'plains'],
  ]);

  it('pathfinding cannot cross a wide river by land, but a boat can', () => {
    const tiles: Record<string, { col: number; row: number; type: string; terrain: string; visible: boolean; explored: boolean }> = {};
    const set = (type: string, c: number, r: number) => {
      tiles[`${c},${r}`] = { col: c, row: r, type, terrain: type, visible: true, explored: true };
    };
    // 4x1: plains | river | river | plains
    set('plains', 0, 0); set('river', 1, 0); set('river', 2, 0); set('plains', 3, 0);
    const getTileAt = (c: number, r: number) => tiles[`${c},${r}`] ?? null;

    const landPath = Pathfinding.findPath(0, 0, 3, 0, getTileAt, 'warrior', 4, 1);
    expect(landPath.success).toBe(false);
    expect(landPath.path).toHaveLength(0);

    // A boat navigates the river — but only to water tiles (a ship can never
    // end its move on the far bank; the target here is the far river tile).
    const boatPath = Pathfinding.findPath(1, 0, 2, 0, getTileAt, 'trireme', 4, 1);
    expect(boatPath.success).toBe(true);
    expect(boatPath.path.length).toBeGreaterThan(0);
  });

  it('a single-tile river is still crossable by land', () => {
    const tiles: Record<string, { col: number; row: number; type: string; terrain: string; visible: boolean; explored: boolean }> = {};
    const set = (type: string, c: number, r: number) => {
      tiles[`${c},${r}`] = { col: c, row: r, type, terrain: type, visible: true, explored: true };
    };
    set('plains', 0, 0); set('river', 1, 0); set('plains', 2, 0);
    const getTileAt = (c: number, r: number) => tiles[`${c},${r}`] ?? null;

    const landPath = Pathfinding.findPath(0, 0, 2, 0, getTileAt, 'warrior', 3, 1);
    expect(landPath.success).toBe(true);
  });

  it('treats the two banks of a wide river as separate landmasses', () => {
    const e = wideRiverMap();
    expect(e.areLandConnected(1, 1, 4, 1)).toBe(false);
    expect(e.areLandConnected(0, 0, 1, 2)).toBe(true);
    // Ships can navigate the river itself.
    expect(Pathfinding.getMovementCost(
      { col: 2, row: 0, type: 'river', terrain: 'river', visible: true, explored: true }, 'trireme',
    )).toBeLessThan(Infinity);
  });

  it('a wide-river city can build a boat and the AI knows it needs one', () => {
    const e = wideRiverMap();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).civilizations = [{ id: 0, technologies: ['sailing'] }];
    // Left-bank city and a right-bank city — the empire is split by the river.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).cities = [
      { id: 'left', name: 'Left', civilizationId: 0, col: 1, row: 1, population: 2, buildings: [], buildQueue: [] },
      { id: 'right', name: 'Right', civilizationId: 0, col: 4, row: 1, population: 2, buildings: [], buildQueue: [] },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e as any).initializePlayerStorage(0);

    expect(e.tileHasRiverAccess(1, 1)).toBe(true);
    expect(e.tileHasNavalAccess(1, 1)).toBe(true);
    expect(e.civCanBuildShips(0)).toBe(true);
    expect(e.civNeedsNavy(0)).toBe(true);

    // …so a ship is actually buildable in the river city.
    const result = e.productionManager.setCityProduction('left', {
      type: 'unit', itemType: 'sail', name: 'Sail', cost: 40,
    } as never);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AI naval production pivot
// ---------------------------------------------------------------------------

describe('AI naval production pivot', () => {
  it('builds a ship when every known enemy is across the water', async () => {
    const { AutoProduction } = await import('@/game/engine/AutoProduction');

    const city = {
      id: 'city-1', name: 'Port', civilizationId: 1, col: 0, row: 0,
      population: 3, buildings: [], currentProduction: null, autoProduction: true,
    };
    const units = [
      { id: 'def', type: 'warrior', civilizationId: 1, col: 0, row: 0, attack: 1, defense: 1 },
      { id: 's1', type: 'settler', civilizationId: 1, col: 5, row: 5 },
      { id: 's2', type: 'settler', civilizationId: 1, col: 6, row: 5 },
    ];
    const productionManager = {
      setCityProduction: vi.fn().mockReturnValue({ success: true }),
      cityHasHarborOrCoast: () => true,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine: any = {
      cities: [city],
      units,
      civilizations: [null, {
        id: 1,
        name: 'NavalCiv',
        technologies: ['sailing'],
        personality: { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5 },
        warWith: new Set(),
      }],
      productionManager,
      getPlayerStorage: () => ({ turnData: {} }),
      squareGrid: { squareDistance: () => 1 },
      roundManager: { getRoundNumber: () => 0 },
      currentYear: -500,
      gameSettings: { difficulty: 'PRINCE' },
      getCityAt: () => null,
      getUnitAt: () => null,
      map: { width: 20, height: 20 },
      civCanBuildShips: () => true,
      civNeedsNavy: () => true,
    };

    const autoProduction = new AutoProduction(engine);
    autoProduction.setAutoProduction('city-1');

    expect(productionManager.setCityProduction).toHaveBeenCalled();
    const item = productionManager.setCityProduction.mock.calls[0][1];
    expect(item.type).toBe('unit');
    expect(['sail', 'trireme', 'caravel', 'frigate', 'ironclad', 'destroyer', 'cruiser', 'battleship'])
      .toContain(item.itemType);
  });
});
