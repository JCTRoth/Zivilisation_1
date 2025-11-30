import { Unit } from '../../../types/game';
import { Pathfinding } from './Pathfinding';

/**
 * GoToManager - Manages unit "Go To" movement commands
 * Handles pathfinding, path execution, and automatic movement along calculated routes
 */
export class GoToManager {
  private gameEngine: any;
  private roundManager: any;
  private unitPaths: Map<string, Array<{ col: number; row: number }>>;

  constructor(gameEngine: any, roundManager: any) {
    this.gameEngine = gameEngine;
    this.roundManager = roundManager;
    this.unitPaths = new Map();
    console.log('[GoToManager] Initialized');
  }

  /**
   * Calculate path for a unit to a destination
   */
  calculatePath(
    unit: Unit,
    targetCol: number,
    targetRow: number,
    getTileAt: (col: number, row: number) => any,
    mapWidth: number,
    mapHeight: number
  ): { success: boolean; path: Array<{ col: number; row: number }> } {
    console.log(`[GoToManager] Calculating path for unit ${unit.id} from (${unit.col},${unit.row}) to (${targetCol},${targetRow})`);

    try {
      const pathResult = Pathfinding.findPath(
        unit.col,
        unit.row,
        targetCol,
        targetRow,
        getTileAt,
        unit.type,
        mapWidth,
        mapHeight
      );

      if (pathResult.success && pathResult.path.length > 1) {
        // Exclude starting position
        const path = pathResult.path.slice(1).map((step: any) => ({
          col: step.col,
          row: step.row
        }));

        console.log(`[GoToManager] Path calculated for unit ${unit.id}, ${path.length} steps`);
        return { success: true, path };
      } else {
        console.log(`[GoToManager] No valid path found for unit ${unit.id}`);
        return { success: false, path: [] };
      }
    } catch (error) {
      console.error(`[GoToManager] Pathfinding error for unit ${unit.id}:`, error);
      return { success: false, path: [] };
    }
  }

  /**
   * Set a Go To path for a unit
   */
  setUnitPath(unitId: string, path: Array<{ col: number; row: number }>): void {
    console.log(`[GoToManager] Setting path for unit ${unitId}, ${path.length} steps`);
    this.unitPaths.set(unitId, path);
    
    // Also sync with RoundManager if available
    if (this.roundManager && typeof this.roundManager.setUnitPath === 'function') {
      this.roundManager.setUnitPath(unitId, path);
    }
  }

  /**
   * Get the path for a unit
   */
  getUnitPath(unitId: string): Array<{ col: number; row: number }> | undefined {
    return this.unitPaths.get(unitId);
  }

  /**
   * Clear the path for a unit
   */
  clearUnitPath(unitId: string): void {
    console.log(`[GoToManager] Clearing path for unit ${unitId}`);
    this.unitPaths.delete(unitId);
    
    // Also clear from RoundManager
    if (this.roundManager && typeof this.roundManager.clearUnitPath === 'function') {
      this.roundManager.clearUnitPath(unitId);
    }
  }

  /**
   * Execute first step of unit's Go To path
   * Returns true if move was successful, false otherwise
   */
  executeFirstStep(unitId: string): { success: boolean; reason?: string; remainingPath: Array<{ col: number; row: number }> } {
    const path = this.unitPaths.get(unitId);
    
    if (!path || path.length === 0) {
      return { success: false, reason: 'no_path', remainingPath: [] };
    }

    const unit = this.gameEngine.units.find((u: any) => u.id === unitId);
    if (!unit) {
      return { success: false, reason: 'unit_not_found', remainingPath: [] };
    }

    if ((unit.movesRemaining || 0) <= 0) {
      return { success: false, reason: 'no_moves', remainingPath: path };
    }

    const nextPos = path[0];
    console.log(`[GoToManager] Executing first step for unit ${unitId} to (${nextPos.col}, ${nextPos.row})`);

    try {
      const moveResult = this.gameEngine.moveUnit(unitId, nextPos.col, nextPos.row);
      
      if (moveResult && moveResult.success) {
        // Remove completed step from path
        const remainingPath = path.slice(1);
        this.setUnitPath(unitId, remainingPath);
        
        console.log(`[GoToManager] Unit ${unitId} moved successfully, ${remainingPath.length} steps remaining`);
        
        // Clear path if complete
        if (remainingPath.length === 0) {
          this.clearUnitPath(unitId);
        }
        
        return { success: true, remainingPath };
      } else {
        console.log(`[GoToManager] Move failed for unit ${unitId}, reason:`, moveResult?.reason);
        return { success: false, reason: moveResult?.reason || 'move_failed', remainingPath: path };
      }
    } catch (error) {
      console.error(`[GoToManager] Error executing move for unit ${unitId}:`, error);
      return { success: false, reason: 'exception', remainingPath: path };
    }
  }

  /**
   * Execute all steps along path while unit has moves
   * Includes delay between steps for animation
   */
  async executePathWithAnimation(
    unitId: string,
    delayMs: number = 300,
    onStepComplete?: (remainingSteps: number) => void
  ): Promise<{ success: boolean; stepsCompleted: number }> {
    console.log(`[GoToManager] Starting animated path execution for unit ${unitId}`);
    
    let stepsCompleted = 0;
    let continueMoving = true;

    while (continueMoving) {
      const unit = this.gameEngine.units.find((u: any) => u.id === unitId);
      if (!unit || (unit.movesRemaining || 0) <= 0) {
        console.log(`[GoToManager] Unit ${unitId} has no more moves`);
        break;
      }

      const path = this.unitPaths.get(unitId);
      if (!path || path.length === 0) {
        console.log(`[GoToManager] Path complete or not found for unit ${unitId}`);
        break;
      }

      const result = this.executeFirstStep(unitId);
      
      if (result.success) {
        stepsCompleted++;
        if (onStepComplete) {
          onStepComplete(result.remainingPath.length);
        }
        
        if (result.remainingPath.length > 0) {
          // Wait before next move for animation
          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          continueMoving = false;
        }
      } else {
        console.log(`[GoToManager] Movement stopped for unit ${unitId}, reason:`, result.reason);
        continueMoving = false;
      }
    }

    console.log(`[GoToManager] Path execution complete for unit ${unitId}, completed ${stepsCompleted} steps`);
    return { success: stepsCompleted > 0, stepsCompleted };
  }

  /**
   * Get all unit paths
   */
  getAllUnitPaths(): Map<string, Array<{ col: number; row: number }>> {
    return new Map(this.unitPaths);
  }

  /**
   * Check if unit has a Go To path
   */
  hasPath(unitId: string): boolean {
    const path = this.unitPaths.get(unitId);
    return path !== undefined && path.length > 0;
  }

  /**
   * Clean up paths for destroyed units
   */
  cleanupDestroyedUnits(existingUnitIds: string[]): void {
    const pathUnitIds = Array.from(this.unitPaths.keys());
    
    for (const unitId of pathUnitIds) {
      if (!existingUnitIds.includes(unitId)) {
        console.log(`[GoToManager] Cleaning up path for destroyed unit ${unitId}`);
        this.clearUnitPath(unitId);
      }
    }
  }
}
