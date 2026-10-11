import { describe, it, expect, beforeEach } from 'vitest';
import { makeEngine, type TestWorld } from './helpers/world';
import type GameEngine from '@/game/engine/GameEngine';

/**
 * Friendly stacking — a unit may move onto a tile already held by another unit
 * of its own civilization (Civ1 behaviour), and the engine must treat that as a
 * walk, never as combat.
 *
 * The UI half (clicking a friendly tile orders the move instead of selecting
 * the unit that stands there, and the destination cursor is released once a
 * route is set) lives in GameCanvas and is not covered here.
 */
describe('Friendly stacking', () => {
  let world: TestWorld;
  let engine: GameEngine;

  /** A fresh warrior on free land, with room to walk. */
  const warriorOnFreeLand = (id: string, extra: Record<string, unknown> = {}) => {
    const origin = world.units.find((u) => u.civilizationId === 0)!;
    const spot = world.landNear(origin.col, origin.row, 5);
    return { spot, unit: world.spawnUnit({ id, type: 'warrior', ...spot, ...extra } as never) };
  };

  beforeEach(async () => {
    world = await makeEngine();
    engine = world.engine;
  });

  it('lets a unit move onto a tile held by a friendly unit', () => {
    const { spot } = warriorOnFreeLand('stack_mover');
    const target = world.landNear(spot.col, spot.row, 2);
    world.spawnUnit({ id: 'stack_resident', type: 'warrior', col: target.col, row: target.row });

    expect(engine.canUnitMoveTo('stack_mover', target.col, target.row)).toBe(true);

    const result = engine.moveUnit('stack_mover', target.col, target.row);

    expect(result.success).toBe(true);
    expect(result.combat).toBeUndefined();
    // Both units now share the tile — the mover kept its identity and no fight happened.
    const stacked = engine.units.filter((u) => u.col === target.col && u.row === target.row);
    expect(stacked.map((u) => u.id).sort()).toEqual(['stack_mover', 'stack_resident']);
    expect(stacked.find((u) => u.id === 'stack_resident')?.health).toBe(100);
  });

  it('keeps stacking legal through the GoTo path plan', () => {
    const { unit } = warriorOnFreeLand('stack_path_mover');
    const target = world.landNear(unit.col, unit.row, 2);
    world.spawnUnit({ id: 'stack_path_resident', type: 'warrior', col: target.col, row: target.row });

    const plan = engine.goToManager.calculatePath(
      unit,
      target.col,
      target.row,
      (col, row) => engine.getTileAt(col, row),
      engine.map.width,
      engine.map.height,
    );

    expect(plan.success).toBe(true);
    expect(plan.attackStepIndex).toBe(-1); // a route to a friendly tile is never an attack
  });

  it('still refuses a unit with no moves left, friend on the tile or not', () => {
    const { spot } = warriorOnFreeLand('stack_spent', { movesRemaining: 0 });
    const target = world.landNear(spot.col, spot.row, 2);
    world.spawnUnit({ id: 'stack_resident_spent', type: 'warrior', col: target.col, row: target.row });

    expect(engine.canUnitMoveTo('stack_spent', target.col, target.row)).toBe(false);
  });

  it('does not stack onto a tile where an enemy stands — that is a fight', () => {
    const { spot } = warriorOnFreeLand('stack_vs_enemy_mover');
    const target = world.landNear(spot.col, spot.row, 2);
    world.spawnUnit({
      id: 'stack_enemy',
      type: 'warrior',
      civilizationId: 1,
      col: target.col,
      row: target.row,
    });

    expect(engine.canUnitMoveTo('stack_vs_enemy_mover', target.col, target.row)).toBe(true);
    const result = engine.moveUnit('stack_vs_enemy_mover', target.col, target.row);
    expect(result.combat || result.success).toBe(true);
  });
});
