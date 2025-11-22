/**
 * RoundManager - Manages turn execution and ensures all players complete their moves
 */
export class RoundManager {
  private gameEngine: any;
  private unitPaths: Map<string, Array<{ col: number; row: number }>>;

  constructor(gameEngine: any) {
    this.gameEngine = gameEngine;
    this.unitPaths = new Map();
    console.log('[RoundManager] Initialized');
  }

  /**
   * Set a path for a unit to follow
   */
  setUnitPath(unitId: string, path: Array<{ col: number; row: number }>): void {
    console.log(`[RoundManager] Setting path for unit ${unitId}:`, path);
    this.unitPaths.set(unitId, path);
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
    console.log(`[RoundManager] Clearing path for unit ${unitId}`);
    this.unitPaths.delete(unitId);
  }

  /**
   * Get all unit paths
   */
  getAllUnitPaths(): Map<string, Array<{ col: number; row: number }>> {
    return new Map(this.unitPaths);
  }

  /**
   * Process automated unit movements at the start of each turn
   */
  processAutomatedMovements(civilizationId: number): void {
    console.log(`[RoundManager] Processing automated movements for civilization ${civilizationId}`);
    
    const units = this.gameEngine.units.filter(
      (u: any) => u.civilizationId === civilizationId && u.movesRemaining > 0
    );

    console.log(`[RoundManager] Found ${units.length} units for civilization ${civilizationId}`);

    for (const unit of units) {
      const path = this.unitPaths.get(unit.id);
      
      if (!path || path.length === 0) {
        continue;
      }

      console.log(`[RoundManager] Unit ${unit.id} has path with ${path.length} steps, movesRemaining: ${unit.movesRemaining}`);

      // Move unit along path while it has moves
      while (unit.movesRemaining > 0 && path.length > 0) {
        const nextPos = path[0];
        console.log(`[RoundManager] Attempting to move unit ${unit.id} to (${nextPos.col}, ${nextPos.row})`);

        try {
          const result = this.gameEngine.moveUnit(unit.id, nextPos.col, nextPos.row);
          
          if (result && result.success) {
            // Remove the first step from path
            path.shift();
            this.unitPaths.set(unit.id, path);
            console.log(`[RoundManager] Unit ${unit.id} moved successfully, ${path.length} steps remaining`);
            
            // If path is complete, clear it
            if (path.length === 0) {
              this.clearUnitPath(unit.id);
              console.log(`[RoundManager] Unit ${unit.id} reached destination`);

              // If this unit is a settler, attempt to found a city
              try {
                const u = this.gameEngine.units.find((x: any) => x.id === unit.id);
                if (u && u.type === 'settlers') {
                  console.log(`[RoundManager] Settler ${unit.id} reached its path destination, attempting to found city`);
                  const founded = this.gameEngine.foundCityWithSettler(unit.id);
                  if (founded) {
                    console.log(`[RoundManager] Settler ${unit.id} founded a city successfully`);
                  } else {
                    console.log(`[RoundManager] Settler ${unit.id} could not found a city at destination`);
                  }
                }
              } catch (e) {
                console.error('[RoundManager] Error attempting to found city with settler:', e);
              }
            }
          } else {
            // Movement failed - clear the path
            console.log(`[RoundManager] Movement failed for unit ${unit.id}, clearing path. Reason:`, result?.reason);
            this.clearUnitPath(unit.id);
            break;
          }
        } catch (error) {
          console.error(`[RoundManager] Error moving unit ${unit.id}:`, error);
          this.clearUnitPath(unit.id);
          break;
        }
      }
    }
  }

  /**
   * Execute turn for a civilization
   */
  executeCivilizationTurn(civilizationId: number): void {
    console.log(`[RoundManager] Executing turn for civilization ${civilizationId}`);
    
    // First, process automated movements (follow paths)
    this.processAutomatedMovements(civilizationId);

    // Refresh units after movements
    const units = this.gameEngine.units.filter(
      (u: any) => u.civilizationId === civilizationId
    );

    console.log(`[RoundManager] Civilization ${civilizationId} has ${units.length} units after automated movements`);

    // Check if this is an AI civilization
    const civ = this.gameEngine.civilizations[civilizationId];
    if (civ && civ.isAI && civilizationId !== 0) {
      console.log(`[RoundManager] Civilization ${civilizationId} is AI, triggering AI turn`);
      // AI will handle its own moves
      if (this.gameEngine.processAITurn) {
        this.gameEngine.processAITurn(civilizationId);
      }
    } else {
      console.log(`[RoundManager] Civilization ${civilizationId} is human player`);
    }
  }

  /**
   * Start a new round - called when turn advances
   */
  startNewRound(activePlayer: number): void {
    console.log(`[RoundManager] Starting new round for player ${activePlayer}`);
    this.executeCivilizationTurn(activePlayer);
  }

  /**
   * Clean up paths for destroyed units
   */
  cleanupDestroyedUnits(existingUnitIds: string[]): void {
    const pathUnitIds = Array.from(this.unitPaths.keys());
    
    for (const unitId of pathUnitIds) {
      if (!existingUnitIds.includes(unitId)) {
        console.log(`[RoundManager] Cleaning up path for destroyed unit ${unitId}`);
        this.clearUnitPath(unitId);
      }
    }
  }
}
