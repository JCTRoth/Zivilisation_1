import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGameStore } from '@/stores/GameStore';
import MoveAnimator from '@/game/rendering/MoveAnimator';
import { getUnitDisplayTile } from '@/game/rendering/MapRenderer';
import type { Unit } from '../types/game';

/**
 * The animation system must be disable-able for headless tests: with
 * `enableAnimations=false` (or `animationSpeed=0`) the deferred-commit
 * MoveAnimator commits the engine move immediately instead of waiting for a
 * glide. These tests lock in that contract plus the rendering interpolation.
 */

const makeUnit = (overrides: Partial<Unit> = {}): Unit => ({
  id: 'u1',
  type: 'warrior',
  civilizationId: 0,
  col: 1,
  row: 1,
  movesRemaining: 2,
  health: 100,
  icon: 'warrior',
  isSleeping: false,
  isFortified: false,
  isSkipped: false,
  areTurnsDone: false,
  ...overrides,
});

/** A minimal engine that MoveAnimator can drive. */
function makeEngine() {
  const unit = makeUnit();
  const moveUnit = vi.fn((id: string, col: number, row: number) => {
    if (id !== 'u1') return { success: false, reason: 'unit_not_found' };
    unit.col = col;
    unit.row = row;
    unit.movesRemaining = Math.max(0, (unit.movesRemaining ?? 0) - 1);
    return { success: true };
  });
  const canUnitMoveTo = vi.fn(() => true);
  return { engine: { units: [unit], moveUnit, canUnitMoveTo }, unit };
}

describe('MoveAnimator', () => {
  beforeEach(() => {
    useGameStore.getState().actions.updateSettings({ enableAnimations: false, animationSpeed: 0, cameraGlideSpeed: 0 });
    useGameStore.getState().actions.clearMovementAnimations();
    useGameStore.getState().actions.setUnitAnimating(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('commits instantly when animations are disabled (no glide registered)', async () => {
    const { engine, unit } = makeEngine();
    const animator = new MoveAnimator(engine as any);
    const addMovementAnimation = vi.spyOn(useGameStore.getState().actions, 'addMovementAnimation');

    const result = await animator.moveAlongPath('u1', [{ col: 2, row: 2 }]);

    expect(result.success).toBe(true);
    expect(unit.col).toBe(2);
    expect(unit.row).toBe(2);
    expect(addMovementAnimation).not.toHaveBeenCalled();
    expect(useGameStore.getState().isUnitAnimating).toBe(false);
  });

  it('glides (registers an animation) before committing when animations are enabled', async () => {
    useGameStore.getState().actions.updateSettings({ enableAnimations: true, animationSpeed: 1 });
    const { engine, unit } = makeEngine();
    const animator = new MoveAnimator(engine as any);
    const addMovementAnimation = vi.spyOn(useGameStore.getState().actions, 'addMovementAnimation');

    vi.useFakeTimers();
    const promise = animator.moveAlongPath('u1', [{ col: 2, row: 2 }]);
    // A glide is registered and the commit is deferred (unit still at the old tile).
    expect(addMovementAnimation).toHaveBeenCalledTimes(1);
    expect(unit.col).toBe(1);

    await vi.advanceTimersByTimeAsync(300);
    await promise;

    expect(unit.col).toBe(2);
    expect(useGameStore.getState().isUnitAnimating).toBe(false);
  });
});

describe('getUnitDisplayTile', () => {
  it('returns the unit tile when no animation applies', () => {
    const unit = makeUnit({ col: 5, row: 7 });
    expect(getUnitDisplayTile(unit, [])).toEqual({ col: 5, row: 7 });
  });

  it('interpolates a glide between the from and to tiles', () => {
    const unit = makeUnit({ col: 5, row: 7 });
    const anim = {
      id: 'a',
      unitId: 'u1',
      fromCol: 5,
      fromRow: 7,
      toCol: 6,
      toRow: 8,
      startTime: performance.now() - 125,
      duration: 250,
    };
    const tile = getUnitDisplayTile(unit, [anim]);
    expect(tile.col).toBeGreaterThan(5);
    expect(tile.col).toBeLessThan(6);
    expect(tile.row).toBeGreaterThan(7);
    expect(tile.row).toBeLessThan(8);
  });
});
