import type { Unit } from '../../../types/game';

/**
 * Unit Action utilities for handling unit commands
 * Handles skipping units, sleep, fortification, and other unit actions
 */
export class UnitActionManager {
  /**
   * Skip a unit's turn - sets all movement points to 0
   */
  static skipUnit(unit: Unit): boolean {
    if (!unit) {
      console.warn('[UnitActionManager] Skip: No unit provided');
      return false;
    }

    const previousMoves = unit.movesRemaining || 0;
    unit.movesRemaining = 0;
    unit.isSkipped = true;

    console.log(`[UnitActionManager] Unit ${unit.id} (${unit.type}) skipped turn. Previous moves: ${previousMoves}, Current moves: ${unit.movesRemaining}`);
    return true;
  }

  /**
   * Put a unit to sleep (will activate next turn if nothing happens nearby)
   */
  static sleepUnit(unit: Unit): boolean {
    if (!unit) {
      console.warn('[UnitActionManager] Sleep: No unit provided');
      return false;
    }

    // Sleeping units retain their movement points but are not selected in unit cycle
    unit.isSleeping = true;
    unit.isSkipped = false;

    console.log(`[UnitActionManager] Unit ${unit.id} (${unit.type}) went to sleep. Moves remaining: ${unit.movesRemaining}`);
    return true;
  }

  /**
   * Fortify a unit (increases defense, prevents movement)
   */
  static fortifyUnit(unit: Unit): boolean {
    if (!unit) {
      console.warn('[UnitActionManager] Fortify: No unit provided');
      return false;
    }

    unit.movesRemaining = 0;
    unit.isFortified = true;
    unit.isSkipped = false;
    unit.isSleeping = false;

    // Increase defense temporarily (typically 50% bonus in Civ1)
    const defenseBonusMultiplier = 1.5;
    console.log(`[UnitActionManager] Unit ${unit.id} (${unit.type}) fortified. Defense bonus: ${(defenseBonusMultiplier - 1) * 100}%`);

    return true;
  }

  /**
   * Wake up a unit that's sleeping
   */
  static wakeUnit(unit: Unit): void {
    if (!unit) return;

    unit.isSleeping = false;
    console.log(`[UnitActionManager] Unit ${unit.id} (${unit.type}) woke up`);
  }

  /**
   * Unfortify a unit
   */
  static unfortifyUnit(unit: Unit): void {
    if (!unit) return;

    unit.isFortified = false;
    console.log(`[UnitActionManager] Unit ${unit.id} (${unit.type}) removed fortification`);
  }

  /**
   * Reset all unit action states
   */
  static resetUnitState(unit: Unit): void {
    if (!unit) return;

    unit.isSkipped = false;
    unit.isSleeping = false;
    unit.isFortified = false;
  }

  /**
   * Check if a unit can perform an action
   */
  static canPerformAction(unit: Unit, action: string, costInMoves: number = 0): boolean {
    if (!unit) return false;

    const hasEnoughMoves = (unit.movesRemaining || 0) >= costInMoves;
    const canPerform = hasEnoughMoves && !unit.isFortified;

    if (!canPerform) {
      const reason = !hasEnoughMoves ? 'insufficient_moves' : 'unit_fortified';
      console.log(`[UnitActionManager] Unit ${unit.id} cannot perform "${action}": ${reason}`);
    }

    return canPerform;
  }

  /**
   * Get action display name with icon
   */
  static getActionDisplay(action: string): { name: string; icon: string } {
    const displays: Record<string, { name: string; icon: string }> = {
      skip_turn: { name: 'Skip Turn', icon: '??' },
      sleep: { name: 'Sleep', icon: '?' },
      fortify: { name: 'Fortify', icon: '??' },
      wake: { name: 'Wake', icon: '??' },
      unfortify: { name: 'Unfortify', icon: '??' },
    };

    return displays[action] || { name: action, icon: '?' };
  }
}

/**
 * Extended Unit type with action properties
 */
export interface UnitWithActions extends Unit {
  isSkipped?: boolean;
  isSleeping?: boolean;
  isFortified?: boolean;
}
