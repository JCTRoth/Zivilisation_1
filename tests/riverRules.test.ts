/**
 * River rules — the design examples from the TODO:
 *
 *   Example 1 (1-wide vertical)   Example 2            Example 3
 *   L R L                         L R R L              L R R L
 *   L R L                         L R L L              L R L L
 *   L R L                         L R R L              L R L L
 *                                                      L R R L
 *
 * Land units may only enter ONE-TILE-WIDE river sections; 2+ wide tiles are
 * impassable from every direction. The same rule powers movement, pathfinding,
 * the AI and landmass connectivity (all through `RiverRules`).
 *
 * Also covers the "rivers can hold fish at half the ocean rate" rule.
 */
import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { SquareGrid } from '@/game/SquareGrid';
import { Pathfinding } from '@/game/engine/Pathfinding';
import { isRiverTile, isWideRiverTile, isFordableRiverTile, riverWidthsAt, MAX_FORDABLE_RIVER_WIDTH } from '@/game/engine/RiverRules';
import {
  TERRAIN_TYPES,
  TERRAIN_RESOURCES,
  RESOURCE_SPAWN_CHANCE,
  DEFAULT_RESOURCE_SPAWN_CHANCE,
  RIVER_FISH_CHANCE_MULTIPLIER,
  getResourceYields,
} from '@/data/TerrainConstants';
import { rollResource } from '@/game/engine/MapGenerator/MapGeneratorHelper';

type Rows = string[][];

const L = TERRAIN_TYPES.PLAINS;
const R = TERRAIN_TYPES.RIVER;

const EXAMPLE_1: Rows = [
  [L, R, L],
  [L, R, L],
  [L, R, L],
];
const EXAMPLE_2: Rows = [
  [L, R, R, L],
  [L, R, L, L],
  [L, R, R, L],
];
const EXAMPLE_3: Rows = [
  [L, R, R, L],
  [L, R, L, L],
  [L, R, L, L],
  [L, R, R, L],
];

/** Tile lookup over a row-spec map (out of bounds → null). */
const lookupFor = (rows: Rows) => (col: number, row: number) => {
  const type = rows[row]?.[col];
  return type ? { col, row, type, terrain: type, visible: true, explored: true } : null;
};

interface TestUnitRecord {
  id: string;
  type: string;
  civilizationId: number;
  col: number;
  row: number;
  movesRemaining: number;
  maxMoves: number;
  health: number;
  attack: number;
  defense: number;
  isDefeated: boolean;
}

/** Minimal engine with a fully controlled map and a single land unit. */
function makeEngine(rows: Rows, unitCol = 0, unitRow = 0, type = 'warrior'): { engine: GameEngine; unit: TestUnitRecord } {
  const height = rows.length;
  const width = rows[0].length;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = new GameEngine(null) as any;
  const unit: TestUnitRecord = {
    id: 'u1', type, civilizationId: 0, col: unitCol, row: unitRow,
    movesRemaining: 3, maxMoves: 3, health: 100, attack: 2, defense: 1, isDefeated: false,
  };
  e.units = [unit];
  e.cities = [];
  e.civilizations = [{ id: 0, technologies: [] }];
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
      row.map((t, c) => ({ col: c, row: r, type: t, terrain: t, visible: true, explored: true })),
    ),
  };
  e.checkAndEndTurnIfNoMoves = () => undefined;
  return { engine: e as GameEngine, unit };
}

// ---------------------------------------------------------------------------
// RiverRules: width detection
// ---------------------------------------------------------------------------

describe('RiverRules: width detection', () => {
  it('recognizes river tiles and only 1-wide sections are fordable', () => {
    expect(isRiverTile({ type: R })).toBe(true);
    expect(isRiverTile({ type: L })).toBe(false);
    expect(isRiverTile(null)).toBe(false);
    expect(MAX_FORDABLE_RIVER_WIDTH).toBe(1);

    const ex1 = lookupFor(EXAMPLE_1);
    for (let row = 0; row < EXAMPLE_1.length; row++) {
      expect(isWideRiverTile(1, row, ex1)).toBe(false);
      expect(isFordableRiverTile(1, row, ex1)).toBe(true);
      expect(riverWidthsAt(1, row, ex1)).toEqual({ horizontal: 1, vertical: 3 });
    }

    const ex2 = lookupFor(EXAMPLE_2);
    // Row 1 river tiles are 2 wide horizontally AND run down col 1 → wide.
    expect(isWideRiverTile(1, 0, ex2)).toBe(true);
    // The middle tile is the single fordable crossing.
    expect(isWideRiverTile(1, 1, ex2)).toBe(false);
    expect(isFordableRiverTile(1, 1, ex2)).toBe(true);
    expect(isWideRiverTile(1, 2, ex2)).toBe(true);
    // The arm tips are 1 tall, so they are not "wide" even though they sit in
    // a 2-tile horizontal arm (they can never be used to cross: the second
    // river tile is wide).
    expect(isWideRiverTile(2, 0, ex2)).toBe(false);
    expect(riverWidthsAt(2, 0, ex2)).toEqual({ horizontal: 2, vertical: 1 });
  });

  it('example 3: the narrow rows are walkable, the 2-wide end is not', () => {
    const ex3 = lookupFor(EXAMPLE_3);
    expect(isFordableRiverTile(1, 1, ex3)).toBe(true);
    expect(isFordableRiverTile(1, 2, ex3)).toBe(true);
    expect(isWideRiverTile(1, 3, ex3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pathfinding
// ---------------------------------------------------------------------------

describe('RiverRules: pathfinding', () => {
  it('crosses a 1-wide river (example 1)', () => {
    const getTileAt = lookupFor(EXAMPLE_1);
    const path = Pathfinding.findPath(0, 1, 2, 1, getTileAt, 'warrior', 3, 3);
    expect(path.success).toBe(true);
    expect(path.path.map((p) => `${p.col},${p.row}`)).toEqual(['0,1', '1,1', '2,1']);
  });

  it('crosses only at the 1-wide row (example 2)', () => {
    const getTileAt = lookupFor(EXAMPLE_2);
    expect(Pathfinding.findPath(0, 1, 3, 1, getTileAt, 'warrior', 4, 3).success).toBe(true);
    // A direct step into a wide river tile is never allowed.
    const intoWide = Pathfinding.findPath(0, 0, 1, 0, getTileAt, 'warrior', 4, 3);
    expect(intoWide.success).toBe(false);
    const downRiver = Pathfinding.findPath(1, 1, 1, 2, getTileAt, 'warrior', 4, 3);
    expect(downRiver.success).toBe(false);
  });

  it('walks along a 1-wide section but cannot enter the 2-wide end (example 3)', () => {
    const getTileAt = lookupFor(EXAMPLE_3);
    expect(Pathfinding.findPath(1, 1, 1, 2, getTileAt, 'warrior', 4, 4).success).toBe(true);
    expect(Pathfinding.findPath(1, 2, 1, 3, getTileAt, 'warrior', 4, 4).success).toBe(false);
  });

  it('the reachable-tile overlay also blocks wide river tiles', () => {
    const getTileAt = lookupFor(EXAMPLE_2);
    const reachable = Pathfinding.getReachableTiles(0, 0, 5, getTileAt, 'warrior', 4, 3);
    expect(reachable.has('1,0')).toBe(false); // wide river tile
  });
});

// ---------------------------------------------------------------------------
// Engine movement (player + AI share this)
// ---------------------------------------------------------------------------

describe('RiverRules: engine movement', () => {
  it('example 1: a land unit crosses left to right and back', () => {
    const { engine, unit } = makeEngine(EXAMPLE_1, 0, 1);
    expect(engine.canUnitMoveTo(unit.id, 1, 1)).toBe(true);
    expect(engine.moveUnit(unit.id, 1, 1).success).toBe(true);
    expect(engine.canUnitMoveTo(unit.id, 2, 1)).toBe(true);
    expect(engine.moveUnit(unit.id, 2, 1).success).toBe(true);
    // …and back.
    expect(engine.canUnitMoveTo(unit.id, 1, 1)).toBe(true);
    expect(engine.moveUnit(unit.id, 1, 1).success).toBe(true);
  });

  it('example 2: only the middle row is passable; canMoveUnit agrees', () => {
    const { engine, unit } = makeEngine(EXAMPLE_2, 0, 1);
    expect(engine.canUnitMoveTo(unit.id, 1, 1)).toBe(true);
    expect(engine.canMoveUnit(unit.id, 1, 1)).toBe(true);

    // Wide tiles are blocked from the side and from the river itself.
    expect(engine.canUnitMoveTo(unit.id, 1, 0)).toBe(false);
    expect(engine.canMoveUnit(unit.id, 1, 0)).toBe(false);
    expect(engine.moveUnit(unit.id, 1, 0).success).toBe(false);

    unit.col = 1; unit.row = 1; unit.movesRemaining = 3;
    expect(engine.canUnitMoveTo(unit.id, 1, 2)).toBe(false); // down the wide river
    expect(engine.canUnitMoveTo(unit.id, 1, 0)).toBe(false); // up the wide river
  });

  it('example 3: walk between the narrow rows, blocked into the wide row', () => {
    const { engine, unit } = makeEngine(EXAMPLE_3, 1, 1);
    expect(engine.canUnitMoveTo(unit.id, 1, 2)).toBe(true);
    expect(engine.moveUnit(unit.id, 1, 2).success).toBe(true);
    expect(engine.canUnitMoveTo(unit.id, 1, 3)).toBe(false);
  });

  it('isTilePassable (AI target filter) rejects wide river tiles only', () => {
    const { engine } = makeEngine(EXAMPLE_3, 0, 0);
    expect(engine.isTilePassable(1, 1)).toBe(true);  // narrow river
    expect(engine.isTilePassable(1, 2)).toBe(true);  // narrow river
    // (1,3) runs down the whole 4-row river → wide, impassable.
    expect(engine.isTilePassable(1, 3)).toBe(false);
    // (2,3) is the 1-tall tip of the bottom arm → fordable, like example 2's
    // arm tips (the river is 1 tile wide vertically there).
    expect(engine.isTilePassable(2, 3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Landmass connectivity (AI reachability / navy pivot)
// ---------------------------------------------------------------------------

describe('RiverRules: landmass connectivity', () => {
  it('a fordable 1-wide river does not split the landmass', () => {
    const { engine } = makeEngine(EXAMPLE_1, 0, 0);
    expect(engine.areLandConnected(0, 0, 2, 0)).toBe(true);
    expect(engine.getLandmassId(1, 0)).toBeGreaterThanOrEqual(0);
  });

  it('a fully 2-wide river splits the landmasses', () => {
    const rows: Rows = [
      [L, R, R, L],
      [L, R, R, L],
      [L, R, R, L],
    ];
    const { engine } = makeEngine(rows, 0, 0);
    expect(engine.areLandConnected(0, 0, 3, 0)).toBe(false);
    expect(engine.getLandmassId(1, 0)).toBe(-1);
  });

  it('a wide river with a ford keeps the banks connected through the ford', () => {
    const { engine } = makeEngine(EXAMPLE_2, 0, 0);
    expect(engine.areLandConnected(0, 0, 3, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// River fish (half the ocean rate)
// ---------------------------------------------------------------------------

describe('River fish', () => {
  it('rivers can carry Fish and yield food like ocean fish', () => {
    expect(TERRAIN_RESOURCES[TERRAIN_TYPES.RIVER]).toBe('Fish');
    expect(getResourceYields('Fish', TERRAIN_TYPES.RIVER).food).toBe(2);
  });

  it('river fish spawns at half the ocean probability', () => {
    expect(RESOURCE_SPAWN_CHANCE[TERRAIN_TYPES.RIVER])
      .toBeCloseTo(RESOURCE_SPAWN_CHANCE[TERRAIN_TYPES.OCEAN] * RIVER_FISH_CHANCE_MULTIPLIER);
    expect(RESOURCE_SPAWN_CHANCE[TERRAIN_TYPES.RIVER])
      .toBeCloseTo(DEFAULT_RESOURCE_SPAWN_CHANCE * 0.5);

    // Just below the river threshold → fish; at the ocean threshold → no fish.
    expect(rollResource(TERRAIN_TYPES.RIVER, false, () => 0.05)).toBe('Fish');
    expect(rollResource(TERRAIN_TYPES.RIVER, false, () => 0.1)).toBeNull();
    expect(rollResource(TERRAIN_TYPES.OCEAN, false, () => 0.1)).toBe('Fish');
    // A tile flagged as special always receives its terrain resource.
    expect(rollResource(TERRAIN_TYPES.RIVER, true, () => 0.99)).toBe('Fish');
  });
});
