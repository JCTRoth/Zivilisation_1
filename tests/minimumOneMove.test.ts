import { afterEach, describe, expect, it } from 'vitest';
import GameEngine from '@shared/game/engine/GameEngine';

/**
 * Civ1 "Minimum 1 Move" rule regression tests.
 *
 * In Civilization 1 a unit that has not yet performed ANY action this turn
 * (moves_current === moves_max, has_moved_this_turn === false) may always
 * enter ONE adjacent tile, even when that tile's terrain cost exceeds its
 * remaining movement points. The forced move consumes all remaining points.
 * Once the unit has acted, only `moves_current >= cost` moves are allowed.
 */
describe('Civ1 Minimum 1 Move rule', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as any).units = [];
      (engine as any).cities = [];
      (engine as any).civilizations = [];
      engine = null;
    }
  });

  async function setup(): Promise<GameEngine> {
    const e = new GameEngine(null);
    (e as any).sleep = () => Promise.resolve();
    e.isPaused = true;
    await e.initialize({
      numberOfCivilizations: 2,
      mapType: 'AI_VS_AI',
      devMode: false,
      startingGold: 100,
    });
    engine = e;
    return e;
  }

  interface TestUnit {
    id: string;
    type: string;
    civilizationId: number;
    col: number;
    row: number;
    movesRemaining: number;
    maxMoves: number;
    hasMovedThisTurn: boolean;
    health: number;
  }

  /**
   * Place a single unit on an interior land tile and turn a neighbor into the
   * requested terrain type. Returns the target tile.
   */
  function placeUnitOnLand(e: GameEngine, unit: TestUnit, targetTerrain: string) {
    (e as any).units = [unit];
    (e as any).cities = [];

    const neighbors = e.squareGrid!.getNeighbors(unit.col, unit.row);
    const target = neighbors[0];
    const tile = e.getTileAt(target.col, target.row) as any;
    tile.type = targetTerrain;
    tile.terrain = targetTerrain;
    return target;
  }

  it('Test 1: fresh Settler (1.0 moves) can enter a Mountain (cost 3) — Minimum 1 Move', async () => {
    const e = await setup();
    const settler: TestUnit = {
      id: 'settler_t1',
      type: 'settler',
      civilizationId: 0,
      col: 5,
      row: 5,
      movesRemaining: 1.0,
      maxMoves: 1.0,
      hasMovedThisTurn: false,
      health: 100,
    };

    const target = placeUnitOnLand(e, settler, 'mountains');

    expect(e.canUnitMoveTo(settler.id, target.col, target.row)).toBe(true);

    const result = e.moveUnit(settler.id, target.col, target.row);
    expect(result.success).toBe(true);
    expect(settler.col).toBe(target.col);
    expect(settler.row).toBe(target.row);
    // The forced move consumes ALL remaining movement points.
    expect(settler.movesRemaining).toBe(0);
    expect(settler.hasMovedThisTurn).toBe(true);
  });

  it('Test 2: Settler after an action (0.67 moves, has moved) cannot enter a Jungle (cost 2)', async () => {
    const e = await setup();
    // Simulates the unit having moved along a road first (cost 1/3), leaving
    // moves_current = 0.67 and has_moved_this_turn = true.
    const settler: TestUnit = {
      id: 'settler_t2',
      type: 'settler',
      civilizationId: 0,
      col: 5,
      row: 5,
      movesRemaining: 1.0 - 1 / 3,
      maxMoves: 1.0,
      hasMovedThisTurn: true,
      health: 100,
    };

    const target = placeUnitOnLand(e, settler, 'jungle');

    expect(e.canUnitMoveTo(settler.id, target.col, target.row)).toBe(false);

    const result = e.moveUnit(settler.id, target.col, target.row);
    expect(result.success).toBe(false);
    // Unit stays put and keeps its remaining moves.
    expect(settler.col).toBe(5);
    expect(settler.row).toBe(5);
    expect(settler.movesRemaining).toBeCloseTo(1.0 - 1 / 3);
  });

  it('Test 3: fresh Cavalry (2.0 moves) can enter a Mountain (cost 3) — Minimum 1 Move', async () => {
    const e = await setup();
    const cavalry: TestUnit = {
      id: 'cavalry_t3',
      type: 'cavalry',
      civilizationId: 0,
      col: 5,
      row: 5,
      movesRemaining: 2.0,
      maxMoves: 2.0,
      hasMovedThisTurn: false,
      health: 100,
    };

    const target = placeUnitOnLand(e, cavalry, 'mountains');

    expect(e.canUnitMoveTo(cavalry.id, target.col, target.row)).toBe(true);

    const result = e.moveUnit(cavalry.id, target.col, target.row);
    expect(result.success).toBe(true);
    expect(cavalry.col).toBe(target.col);
    expect(cavalry.row).toBe(target.row);
    expect(cavalry.movesRemaining).toBe(0);
    expect(cavalry.hasMovedThisTurn).toBe(true);
  });

  it('Test 3b (negative): Cavalry that already moved (1.0 left) cannot enter a Mountain (cost 3)', async () => {
    const e = await setup();
    const cavalry: TestUnit = {
      id: 'cavalry_t3b',
      type: 'cavalry',
      civilizationId: 0,
      col: 5,
      row: 5,
      movesRemaining: 1.0,
      maxMoves: 2.0,
      hasMovedThisTurn: true,
      health: 100,
    };

    const target = placeUnitOnLand(e, cavalry, 'mountains');

    expect(e.canUnitMoveTo(cavalry.id, target.col, target.row)).toBe(false);

    const result = e.moveUnit(cavalry.id, target.col, target.row);
    expect(result.success).toBe(false);
    expect(cavalry.col).toBe(5);
    expect(cavalry.row).toBe(5);
  });

  it('Turn reset restores full movement and clears hasMovedThisTurn', async () => {
    const e = await setup();
    const warrior = {
      id: 'warrior_reset',
      type: 'warrior',
      civilizationId: 0,
      col: 5,
      row: 5,
      movesRemaining: 0,
      maxMoves: 1,
      hasMovedThisTurn: true,
      health: 100,
      workTarget: null,
    };
    (e as any).units = [warrior];
    (e as any).cities = [];

    (e.roundManager as any).resetUnitsForPlayer(0);

    expect(warrior.movesRemaining).toBe(1);
    expect(warrior.hasMovedThisTurn).toBe(false);
  });

  it('Civ1 road: a fresh Settler pays 1/3 to enter a road tile, then cannot enter Jungle (cost 2)', async () => {
    const e = await setup();
    const settler: TestUnit = {
      id: 'settler_road',
      type: 'settler',
      civilizationId: 0,
      col: 5,
      row: 5,
      movesRemaining: 1.0,
      maxMoves: 1.0,
      hasMovedThisTurn: false,
      health: 100,
    };
    (e as any).units = [settler];
    (e as any).cities = [];

    const neighbors = e.squareGrid!.getNeighbors(5, 5);
    // Neighbor 1 becomes a roaded grassland tile (Civ1 road cost = 1/3).
    const road = neighbors[0];
    const roadTile = e.getTileAt(road.col, road.row) as any;
    roadTile.type = 'grassland';
    roadTile.terrain = 'grassland';
    roadTile.improvement = 'road';

    // Neighbor 2 becomes an unimproved jungle tile (cost 2).
    const jungle = neighbors[1];
    const jungleTile = e.getTileAt(jungle.col, jungle.row) as any;
    jungleTile.type = 'jungle';
    jungleTile.terrain = 'jungle';
    jungleTile.improvement = null;

    // Enter the road tile — the settler spends exactly 1/3 of a point.
    expect(e.canUnitMoveTo(settler.id, road.col, road.row)).toBe(true);
    const r1 = e.moveUnit(settler.id, road.col, road.row);
    expect(r1.success).toBe(true);
    expect(settler.movesRemaining).toBeCloseTo(1 - 1 / 3, 5);
    expect(settler.hasMovedThisTurn).toBe(true);

    // Now the jungle (cost 2) is out of reach: the settler has already acted.
    expect(e.canUnitMoveTo(settler.id, jungle.col, jungle.row)).toBe(false);
    const r2 = e.moveUnit(settler.id, jungle.col, jungle.row);
    expect(r2.success).toBe(false);
    expect(settler.col).toBe(road.col);
    expect(settler.row).toBe(road.row);
  });

  it('Civ1 railroad: entering a railroad tile costs only the tiny epsilon (effectively free)', async () => {
    const e = await setup();
    const cavalry: TestUnit = {
      id: 'cavalry_railroad',
      type: 'cavalry',
      civilizationId: 0,
      col: 5,
      row: 5,
      movesRemaining: 2.0,
      maxMoves: 2.0,
      hasMovedThisTurn: false,
      health: 100,
    };
    (e as any).units = [cavalry];
    (e as any).cities = [];

    const neighbors = e.squareGrid!.getNeighbors(5, 5);
    const target = neighbors[0];
    const tile = e.getTileAt(target.col, target.row) as any;
    tile.type = 'grassland';
    tile.terrain = 'grassland';
    tile.improvement = 'railroad';

    const result = e.moveUnit(cavalry.id, target.col, target.row);
    expect(result.success).toBe(true);
    // 2.0 - epsilon → the cavalry keeps almost all of its movement.
    expect(cavalry.movesRemaining).toBeCloseTo(2 - 0.05, 5);
    expect(cavalry.col).toBe(target.col);
    expect(cavalry.row).toBe(target.row);
  });
});
