/**
 * UnitTurnQueue - Manages the turn order of units for each player.
 * 
 * Each player has their own queue that is filled at the start of their turn
 * with all active units. The queue processes units one at a time, allowing
 * the player to move or skip each unit.
 * 
 * Key behaviors:
 * - Queue is filled at turn start with all active units (unit.active === true)
 * - Units are processed in order until queue is empty
 * - A unit can be removed from queue when: moved all moves, becomes inactive, destroyed, or manually skipped
 * - A unit can "wait" which moves it to the end of the queue without removing it
 * - For human players: current unit gets pulsing animation and auto-selection
 * - For AI players: when queue is empty, turn ends automatically
 */

import type { Unit } from '../../../types/game';

export interface QueuedUnit {
  unitId: string;
  processed: boolean; // Has this unit been given a turn this cycle?
}

export class UnitTurnQueue {
  private gameEngine: any;
  
  // Per-player queues: Map<civilizationId, unitId[]>
  private playerQueues: Map<number, string[]> = new Map();
  
  // Current unit being processed for each player
  private currentUnitId: Map<number, string | null> = new Map();
  
  // Callback for state changes
  private onQueueChange: ((civilizationId: number, currentUnitId: string | null, queueLength: number) => void) | null = null;

  constructor(gameEngine: any) {
    this.gameEngine = gameEngine;
    console.log('[UnitTurnQueue] Initialized');
  }

  /**
   * Set callback for queue state changes
   */
  setOnQueueChange(callback: ((civilizationId: number, currentUnitId: string | null, queueLength: number) => void) | null): void {
    this.onQueueChange = callback;
  }

  /**
   * Initialize the queue for a player at the start of their turn.
   * Fills the queue with all active units that have movement remaining.
   */
  initializeQueue(civilizationId: number): void {
    const units = this.gameEngine.units.filter((u: Unit) => 
      u.civilizationId === civilizationId && 
      !u.areTurnsDone && // Unit must not have turns done
      (u.movesRemaining || 0) > 0 // Unit must have moves remaining
    );

    const unitIds = units.map((u: Unit) => u.id);
    this.playerQueues.set(civilizationId, unitIds);
    this.currentUnitId.set(civilizationId, null);

    console.log(`[UnitTurnQueue] Initialized queue for civ ${civilizationId} with ${unitIds.length} units:`, unitIds);

    // Start processing the first unit
    if (unitIds.length > 0) {
      this.nextUnit(civilizationId);
    } else {
      this.emitQueueChange(civilizationId);
    }
  }

  /**
   * Get the current unit for a player (the one that should be shown with pulsing animation)
   */
  getCurrentUnit(civilizationId: number): Unit | null {
    const unitId = this.currentUnitId.get(civilizationId);
    if (!unitId) return null;
    return this.gameEngine.units.find((u: Unit) => u.id === unitId) || null;
  }

  /**
   * Get the current unit ID for a player
   */
  getCurrentUnitId(civilizationId: number): string | null {
    return this.currentUnitId.get(civilizationId) || null;
  }

  /**
   * Get the queue for a player
   */
  getQueue(civilizationId: number): string[] {
    return this.playerQueues.get(civilizationId) || [];
  }

  /**
   * Get the number of units remaining in the queue
   */
  getQueueLength(civilizationId: number): number {
    return this.getQueue(civilizationId).length;
  }

  /**
   * Check if the queue is empty for a player
   */
  isQueueEmpty(civilizationId: number): boolean {
    return this.getQueueLength(civilizationId) === 0;
  }

  /**
   * Move to the next unit in the queue.
   * Called when the current unit is done (moved, skipped, destroyed).
   */
  nextUnit(civilizationId: number): Unit | null {
    const queue = this.playerQueues.get(civilizationId);
    if (!queue || queue.length === 0) {
      this.currentUnitId.set(civilizationId, null);
      this.emitQueueChange(civilizationId);
      console.log(`[UnitTurnQueue] Queue empty for civ ${civilizationId}`);
      return null;
    }

    // Get the first unit in the queue
    const unitId = queue[0];
    const unit = this.gameEngine.units.find((u: Unit) => u.id === unitId);

    // If unit doesn't exist anymore (destroyed), remove it and try next
    if (!unit) {
      queue.shift();
      console.log(`[UnitTurnQueue] Unit ${unitId} no longer exists, trying next`);
      return this.nextUnit(civilizationId);
    }

    // If unit is inactive or has no moves, remove it and try next
    if (unit.areTurnsDone || (unit.movesRemaining || 0) <= 0) {
      queue.shift();
      console.log(`[UnitTurnQueue] Unit ${unitId} (${unit.type}) inactive or no moves, trying next`);
      return this.nextUnit(civilizationId);
    }

    // Set as current unit
    this.currentUnitId.set(civilizationId, unitId);
    this.emitQueueChange(civilizationId);

    console.log(`[UnitTurnQueue] Current unit for civ ${civilizationId}: ${unitId} (${unit.type}) at (${unit.col}, ${unit.row}), ${queue.length} units in queue`);
    return unit;
  }

  /**
   * Mark the current unit as done and move to the next.
   * Called when a unit has moved all its movement points or is skipped.
   */
  unitDone(civilizationId: number, unitId?: string): Unit | null {
    const queue = this.playerQueues.get(civilizationId);
    const currentId = unitId || this.currentUnitId.get(civilizationId);
    
    if (!queue || !currentId) {
      return this.nextUnit(civilizationId);
    }

    // Remove the unit from the queue
    const index = queue.indexOf(currentId);
    if (index !== -1) {
      queue.splice(index, 1);
      console.log(`[UnitTurnQueue] Unit ${currentId} marked done, removed from queue. ${queue.length} remaining`);
    }

    // If it was the current unit, move to next
    if (this.currentUnitId.get(civilizationId) === currentId) {
      this.currentUnitId.set(civilizationId, null);
      return this.nextUnit(civilizationId);
    }

    this.emitQueueChange(civilizationId);
    return this.getCurrentUnit(civilizationId);
  }

  /**
   * Make the current unit "wait" - move it to the end of the queue.
   * The unit keeps its turn later in this round.
   */
  waitUnit(civilizationId: number): Unit | null {
    const queue = this.playerQueues.get(civilizationId);
    const currentId = this.currentUnitId.get(civilizationId);
    
    if (!queue || !currentId) {
      return null;
    }

    // Remove from current position and add to end
    const index = queue.indexOf(currentId);
    if (index !== -1) {
      queue.splice(index, 1);
      queue.push(currentId);
      console.log(`[UnitTurnQueue] Unit ${currentId} waiting, moved to end of queue. Queue:`, queue);
    }

    // Move to the next unit (which is now first in queue)
    this.currentUnitId.set(civilizationId, null);
    return this.nextUnit(civilizationId);
  }

  /**
   * Skip the current unit entirely - remove from queue without waiting.
   */
  skipUnit(civilizationId: number): Unit | null {
    return this.unitDone(civilizationId);
  }

  /**
   * Remove a specific unit from the queue (e.g., when destroyed).
   */
  removeUnit(unitId: string): void {
    for (const [civId, queue] of this.playerQueues.entries()) {
      const index = queue.indexOf(unitId);
      if (index !== -1) {
        queue.splice(index, 1);
        console.log(`[UnitTurnQueue] Unit ${unitId} removed from queue for civ ${civId}`);
        
        // If it was the current unit, move to next
        if (this.currentUnitId.get(civId) === unitId) {
          this.currentUnitId.set(civId, null);
          this.nextUnit(civId);
        } else {
          this.emitQueueChange(civId);
        }
      }
    }
  }

  /**
   * Check if a unit has moved all its movement points and should be removed.
   * Called after each unit movement.
   */
  checkUnitStatus(unitId: string): void {
    const unit = this.gameEngine.units.find((u: Unit) => u.id === unitId);
    if (!unit) {
      this.removeUnit(unitId);
      return;
    }

    // If unit has no moves remaining, mark as done
    if ((unit.movesRemaining || 0) <= 0) {
      console.log(`[UnitTurnQueue] Unit ${unitId} (${unit.type}) has no moves remaining, marking done`);
      this.unitDone(unit.civilizationId, unitId);
    }

    // If unit became inactive, mark as done
    if (unit.areTurnsDone) {
      console.log(`[UnitTurnQueue] Unit ${unitId} (${unit.type}) became inactive, marking done`);
      this.unitDone(unit.civilizationId, unitId);
    }
  }

  /**
   * Clear the queue for a player (e.g., at end of turn).
   */
  clearQueue(civilizationId: number): void {
    this.playerQueues.set(civilizationId, []);
    this.currentUnitId.set(civilizationId, null);
    this.emitQueueChange(civilizationId);
    console.log(`[UnitTurnQueue] Cleared queue for civ ${civilizationId}`);
  }

  /**
   * Add a unit to the queue (e.g., newly created unit).
   */
  addUnit(civilizationId: number, unitId: string): void {
    const queue = this.playerQueues.get(civilizationId);
    if (queue && !queue.includes(unitId)) {
      queue.push(unitId);
      console.log(`[UnitTurnQueue] Added unit ${unitId} to queue for civ ${civilizationId}`);
      this.emitQueueChange(civilizationId);
    }
  }

  /**
   * Emit queue change event
   */
  private emitQueueChange(civilizationId: number): void {
    const currentId = this.currentUnitId.get(civilizationId) || null;
    const queueLength = this.getQueueLength(civilizationId);
    
    if (this.onQueueChange) {
      this.onQueueChange(civilizationId, currentId, queueLength);
    }

    // Also emit via game engine's state change callback
    if (this.gameEngine.onStateChange) {
      this.gameEngine.onStateChange('UNIT_QUEUE_CHANGE', {
        civilizationId,
        currentUnitId: currentId,
        queueLength,
        queue: this.getQueue(civilizationId)
      });
    }
  }

  /**
   * Get debug info about the queue state
   */
  getDebugInfo(civilizationId: number): object {
    return {
      civilizationId,
      queue: this.getQueue(civilizationId),
      currentUnitId: this.getCurrentUnitId(civilizationId),
      queueLength: this.getQueueLength(civilizationId),
      isEmpty: this.isQueueEmpty(civilizationId)
    };
  }
}
