/**
 * Civ1 tile improvement construction:
 *  - Per-terrain worker-turn construction times (the reference table).
 *  - Multi-turn construction (a settler works N turns before the improvement
 *    appears; work is advanced once per turn and abandoned when it moves).
 *  - Irrigation fresh-water adjacency rule.
 *  - Railroads require an existing road; roads are land-only.
 *  - Terrain transformations on completion (irrigate forest/swamp/jungle,
 *    mine grassland/plains).
 */
import { describe, it, expect, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { TERRAIN_TYPES } from '@/data/TerrainConstants';
import {
  IMPROVEMENT_TYPES,
  IMPROVEMENT_PROPERTIES,
} from '@/data/TileImprovementConstants';

describe('Civ1 tile improvement construction', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as unknown as { units: unknown[] }).units = [];
      (engine as unknown as { cities: unknown[] }).cities = [];
      (engine as unknown as { civilizations: unknown[] }).civilizations = [];
      engine = null;
    }
  });

  async function setupEngine(): Promise<GameEngine> {
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (e as unknown as { isPaused: boolean }).isPaused = true;
    await e.initialize({
      numberOfCivilizations: 2,
      mapType: 'AI_VS_AI',
      devMode: false,
      startingGold: 100,
    });
    engine = e;
    return e;
  }

  function placeSettler(e: GameEngine, type: string, moves = 10) {
    const width = (e as unknown as { map: { width: number } }).map.width;
    const tiles = (e as unknown as { map: { tiles: Array<{ type?: string }> } }).map.tiles;
    const index = tiles.findIndex((t) => t && t.type && t.type !== TERRAIN_TYPES.OCEAN);
    if (index < 0) throw new Error('no land tile found');
    const col = index % width;
    const row = Math.floor(index / width);
    const tile = e.getTileAt(col, row) as unknown as {
      type: string;
      terrain?: string;
      resource?: string | null;
      improvement?: string | null;
    };
    tile.type = type;
    tile.terrain = type;
    tile.improvement = null;
    const settler = {
      id: `work_${type}_${col}_${row}`,
      type: 'settler',
      civilizationId: 0,
      col,
      row,
      movesRemaining: moves,
      isFortified: false,
      workTarget: null as string | null,
      workTurns: 0,
    };
    (e as unknown as { units: unknown[] }).units.push(settler);
    return { col, row, tile, settler };
  }

  function ensureRiverAdjacent(e: GameEngine, col: number, row: number): void {
    const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
    for (const [dc, dr] of directions) {
      const tile = e.getTileAt(col + dc, row + dr) as unknown as { type: string; terrain?: string } | undefined;
      if (tile) {
        // Only the terrain flag changes — the tile keeps its type so later
        // tile searches are not redirected to this neighbor.
        tile.terrain = TERRAIN_TYPES.RIVER;
        return;
      }
    }
  }

  /**
   * Strip every water source within `reach` of the tile, so "no supply" is a
   * statement about the whole irrigation reach and not just its four corners.
   */
  function clearFreshWaterWithin(e: GameEngine, col: number, row: number, reach = 6): void {
    for (let dc = -reach; dc <= reach; dc++) {
      for (let dr = -reach; dr <= reach; dr++) {
        const tile = e.getTileAt(col + dc, row + dr) as unknown as
          { type: string; terrain?: string; improvement?: string | null } | undefined;
        if (!tile) continue;
        if (tile.terrain === TERRAIN_TYPES.RIVER || tile.terrain === TERRAIN_TYPES.LAKE) {
          tile.terrain = TERRAIN_TYPES.GRASSLAND;
        }
        if (tile.type === TERRAIN_TYPES.RIVER || tile.type === TERRAIN_TYPES.LAKE) {
          tile.type = TERRAIN_TYPES.GRASSLAND;
        }
        if (tile.improvement === IMPROVEMENT_TYPES.IRRIGATION) tile.improvement = null;
      }
    }
  }

  function setTerrain(e: GameEngine, col: number, row: number, terrain: string): boolean {
    const tile = e.getTileAt(col, row) as unknown as { type: string; terrain?: string } | undefined;
    if (!tile) return false;
    tile.type = terrain;
    tile.terrain = terrain;
    return true;
  }

  function grantTech(e: GameEngine, civId: number, techId: string) {
    const civ = (e as unknown as { civilizations: Array<{ id: number; technologies: string[] }> }).civilizations.find((c) => c.id === civId);
    if (civ && !civ.technologies.includes(techId)) civ.technologies.push(techId);
  }

  // ─── Construction-time table ───────────────────────────────────────

  it('encodes the Civ1 worker-turn construction table', () => {
    const t = (type: string, terrain: string) => IMPROVEMENT_PROPERTIES[type].turnsByTerrain?.[terrain];

    // Irrigation
    expect(t(IMPROVEMENT_TYPES.IRRIGATION, 'grassland')).toBe(5);
    expect(t(IMPROVEMENT_TYPES.IRRIGATION, 'jungle')).toBe(15);
    expect(t(IMPROVEMENT_TYPES.IRRIGATION, 'swamp')).toBe(15);
    expect(t(IMPROVEMENT_TYPES.IRRIGATION, 'forest')).toBe(15);
    expect(t(IMPROVEMENT_TYPES.IRRIGATION, 'hills')).toBeUndefined();
    expect(t(IMPROVEMENT_TYPES.IRRIGATION, 'arctic')).toBeUndefined();
    expect(t(IMPROVEMENT_TYPES.IRRIGATION, 'mountains')).toBeUndefined();
    expect(t(IMPROVEMENT_TYPES.IRRIGATION, 'ocean')).toBeUndefined();
    expect(t(IMPROVEMENT_TYPES.IRRIGATION, 'tundra')).toBeUndefined();

    // Road
    expect(t(IMPROVEMENT_TYPES.ROAD, 'grassland')).toBe(2);
    expect(t(IMPROVEMENT_TYPES.ROAD, 'desert')).toBe(2);
    expect(t(IMPROVEMENT_TYPES.ROAD, 'forest')).toBe(4);
    expect(t(IMPROVEMENT_TYPES.ROAD, 'mountains')).toBe(6);
    expect(t(IMPROVEMENT_TYPES.ROAD, 'arctic')).toBe(6);

    // Railroad (not on arctic)
    expect(t(IMPROVEMENT_TYPES.RAILROAD, 'grassland')).toBe(4);
    expect(t(IMPROVEMENT_TYPES.RAILROAD, 'mountains')).toBe(12);
    expect(t(IMPROVEMENT_TYPES.RAILROAD, 'arctic')).toBeUndefined();

    // Mines (grassland/plains/desert are mineable now)
    expect(t(IMPROVEMENT_TYPES.MINES, 'grassland')).toBe(10);
    expect(t(IMPROVEMENT_TYPES.MINES, 'mountains')).toBe(10);
    expect(t(IMPROVEMENT_TYPES.MINES, 'plains')).toBe(15);
    expect(t(IMPROVEMENT_TYPES.MINES, 'river')).toBeUndefined();
    expect(t(IMPROVEMENT_TYPES.MINES, 'tundra')).toBeUndefined();

    // Fortress (not on arctic)
    expect(t(IMPROVEMENT_TYPES.FORTRESS, 'grassland')).toBe(5);
    expect(t(IMPROVEMENT_TYPES.FORTRESS, 'mountains')).toBe(7);
    expect(t(IMPROVEMENT_TYPES.FORTRESS, 'arctic')).toBeUndefined();
  });

  it('improvementBuildTurns returns the per-terrain value', async () => {
    const e = await setupEngine();
    expect(e.improvementBuildTurns('road', TERRAIN_TYPES.GRASSLAND)).toBe(2);
    expect(e.improvementBuildTurns('mines', TERRAIN_TYPES.GRASSLAND)).toBe(10);
    expect(e.improvementBuildTurns('irrigation', TERRAIN_TYPES.JUNGLE)).toBe(15);
    expect(e.improvementBuildTurns('fortress', TERRAIN_TYPES.TUNDRA)).toBe(5);
  });

  // ─── Multi-turn construction ───────────────────────────────────────

  it('road on grassland completes after 2 worker-turns (starts, then advances once)', async () => {
    const e = await setupEngine();
    const { tile, settler } = placeSettler(e, TERRAIN_TYPES.GRASSLAND);

    expect(e.buildImprovement(settler.id, 'road')).toBe(true);
    // Started: the settler worked its turn (first of the 2) and the tile has
    // no road yet; 1 worker-turn remains.
    expect(settler.workTarget).toBe('road');
    expect(settler.workTurns).toBe(1);
    expect(settler.movesRemaining).toBe(0);
    expect(tile.improvement).toBeNull();

    // Second worker-turn completes it.
    expect(e.advanceUnitWork(settler.id)).toBe(true);
    expect(tile.improvement).toBe('road');
    expect(settler.workTarget).toBeNull();
  });

  it('a settler keeps working across turns until the timer expires', async () => {
    const e = await setupEngine();
    const { tile, settler } = placeSettler(e, TERRAIN_TYPES.MOUNTAINS);

    e.buildImprovement(settler.id, 'mine'); // mines on mountains = 10 turns (first spent now)
    expect(settler.workTurns).toBe(9);
    for (let i = 1; i < 9; i++) {
      expect(e.advanceUnitWork(settler.id)).toBe(false);
      expect(settler.workTurns).toBe(9 - i);
    }
    expect(e.advanceUnitWork(settler.id)).toBe(true); // 10th worker-turn
    expect(tile.improvement).toBe('mines');
    expect(settler.workTarget).toBeNull();
  });

  it('moving a working settler abandons the construction', async () => {
    const e = await setupEngine();
    const { col, row, tile, settler } = placeSettler(e, TERRAIN_TYPES.GRASSLAND);

    e.buildImprovement(settler.id, 'road');
    expect(settler.workTarget).toBe('road');

    // A working settler normally has no moves, so grant some to simulate a
    // scenario where it could still move (the engine must cancel the work).
    const target = e.squareGrid!.getNeighbors(col, row).find((candidate) => {
      const neighbor = e.getTileAt(candidate.col, candidate.row) as unknown as { type: string; terrain?: string } | undefined;
      return neighbor
        && neighbor.type !== TERRAIN_TYPES.OCEAN
        && neighbor.terrain !== TERRAIN_TYPES.OCEAN
        && !e.getUnitAt(candidate.col, candidate.row)
        && !e.getCityAt(candidate.col, candidate.row);
    });
    if (!target) return; // no adjacent land — skip
    // A working settler normally has no moves, but to actually leave the tile
    // it needs enough movement points to afford the (map-dependent) terrain
    // cost of the adjacent tile — grant a generous amount so the move always
    // succeeds regardless of which land tile the generated map puts next door.
    settler.movesRemaining = 10;
    expect(e.moveUnit(settler.id, target.col, target.row).success).toBe(true);

    expect(settler.workTarget).toBeNull();
    expect(settler.workTurns).toBe(0);
    expect(tile.improvement).toBeNull();
  });

  // ─── Irrigation water adjacency ────────────────────────────────────

  it('irrigation is blocked when no water is in reach', async () => {
    const e = await setupEngine();
    const { col, row, settler } = placeSettler(e, TERRAIN_TYPES.GRASSLAND);
    clearFreshWaterWithin(e, col, row);
    expect(e.canBuildImprovement(settler.id, 'irrigation')).toBe(false);
    expect(e.buildImprovement(settler.id, 'irrigation')).toBe(false);
  });

  it('irrigation reaches the water, up to five fields out', async () => {
    const e = await setupEngine();
    const { col, row, settler } = placeSettler(e, TERRAIN_TYPES.GRASSLAND);
    clearFreshWaterWithin(e, col, row);
    expect(e.canBuildImprovement(settler.id, 'irrigation')).toBe(false);

    ensureRiverAdjacent(e, col, row);
    expect(e.canBuildImprovement(settler.id, 'irrigation')).toBe(true);
  });

  it('irrigates across the diagonal, because a canal may bend', async () => {
    const e = await setupEngine();
    const { col, row, settler } = placeSettler(e, TERRAIN_TYPES.GRASSLAND);
    clearFreshWaterWithin(e, col, row);
    // Two orthogonal steps away: reachable, though not touching.
    expect(setTerrain(e, col + 1, row + 1, TERRAIN_TYPES.RIVER)).toBe(true);
    expect(e.canBuildImprovement(settler.id, 'irrigation')).toBe(true);
  });

  it('stops irrigating six fields out, so the reach stays a real limit', async () => {
    const e = await setupEngine();
    const { col, row, settler } = placeSettler(e, TERRAIN_TYPES.GRASSLAND);
    clearFreshWaterWithin(e, col, row, 7);
    expect(setTerrain(e, col + 5, row, TERRAIN_TYPES.RIVER)).toBe(true);
    expect(e.canBuildImprovement(settler.id, 'irrigation')).toBe(true);

    clearFreshWaterWithin(e, col, row, 7);
    expect(setTerrain(e, col + 6, row, TERRAIN_TYPES.RIVER)).toBe(true);
    expect(e.canBuildImprovement(settler.id, 'irrigation')).toBe(false);
  });

  it('irrigation is possible next to an already-irrigated tile', async () => {
    const e = await setupEngine();
    const { col, row, settler } = placeSettler(e, TERRAIN_TYPES.GRASSLAND);
    clearFreshWaterWithin(e, col, row);
    // Put an irrigated tile orthogonally adjacent.
    const north = e.getTileAt(col, row - 1) as unknown as { type: string; improvement: string | null } | undefined;
    if (!north) return;
    north.improvement = IMPROVEMENT_TYPES.IRRIGATION;
    expect(e.canBuildImprovement(settler.id, 'irrigation')).toBe(true);
  });

  it('irrigating grassland leaves the terrain in place and adds irrigation', async () => {
    const e = await setupEngine();
    const { col, row, tile, settler } = placeSettler(e, TERRAIN_TYPES.GRASSLAND);
    ensureRiverAdjacent(e, col, row);

    e.buildImprovement(settler.id, 'irrigation'); // 5 turns on grassland
    for (let i = 1; i < 5; i++) e.advanceUnitWork(settler.id);

    expect(tile.type).toBe(TERRAIN_TYPES.GRASSLAND);
    expect(tile.improvement).toBe(IMPROVEMENT_TYPES.IRRIGATION);
  });

  // ─── Prerequisites ─────────────────────────────────────────────────

  it('railroad requires an existing road', async () => {
    const e = await setupEngine();
    grantTech(e, 0, 'railroad');

    const bare = placeSettler(e, TERRAIN_TYPES.GRASSLAND);
    expect(e.canBuildImprovement(bare.settler.id, 'railroad')).toBe(false);
    expect(e.buildImprovement(bare.settler.id, 'railroad')).toBe(false);

    const withRoad = placeSettler(e, TERRAIN_TYPES.GRASSLAND);
    withRoad.tile.improvement = IMPROVEMENT_TYPES.ROAD;
    expect(e.canBuildImprovement(withRoad.settler.id, 'railroad')).toBe(true);
    expect(e.buildImprovement(withRoad.settler.id, 'railroad')).toBe(true);
    // Railroad (4 turns on grassland) upgrades the road.
    for (let i = 1; i < 4; i++) e.advanceUnitWork(withRoad.settler.id);
    expect(withRoad.tile.improvement).toBe(IMPROVEMENT_TYPES.RAILROAD);
  });

  it('fortress requires the construction tech', async () => {
    const e = await setupEngine();
    const { settler } = placeSettler(e, TERRAIN_TYPES.GRASSLAND);
    expect(e.canBuildImprovement(settler.id, 'fortress')).toBe(false);
    grantTech(e, 0, 'construction');
    expect(e.canBuildImprovement(settler.id, 'fortress')).toBe(true);
  });
});
