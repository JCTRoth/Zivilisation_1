/**
 * AIManager - Manages AI behavior for civilizations
 */

import { AIUtility } from './AIUtility';
import { EnemySearcher } from './EnemySearcher';
import { SettlementEvaluator } from './SettlementEvaluator';
import type { Unit } from '../../../types/game';

export class AIManager {
  private gameEngine: any;

  constructor(gameEngine: any) {
    this.gameEngine = gameEngine;
  }

  /**
   * Process AI turn for a civilization
   */
  async processAITurn(civilizationId: number) {
    const civ = this.gameEngine.civilizations[civilizationId];
    if (!civ) {
      console.warn(`[AI] processAITurn: Civilization ${civilizationId} not found`);
      return;
    }
    if (civ.isHuman) {
      console.log(`[AI] processAITurn: Skipping civilization ${civilizationId} - is human player`);
      return;
    }
    // CRITICAL: Only allow AI to act during its own turn
    if (this.gameEngine.activePlayer !== civilizationId) {
      console.warn(`[AI] processAITurn: Civilization ${civilizationId} attempted to act outside its turn (active player: ${this.gameEngine.activePlayer})`);
      return;
    }
    // Return promise so RoundManager can coordinate timeouts/end-of-turn
    return this.runAITurn(civilizationId).catch(err => console.error('AI turn error', err));
  }

  /**
   * Run an asynchronous AI turn for civilizationId
   */
  private async runAITurn(civilizationId: number) {
    const civ = this.gameEngine.civilizations[civilizationId];
    if (!civ || civ.isHuman) {
      console.log(`[AI] runAITurn: Skipping civilization ${civilizationId} - not AI or is human`);
      return;
    }
    // CRITICAL: Verify this is still the active player before proceeding
    if (this.gameEngine.activePlayer !== civilizationId) {
      console.warn(`[AI] runAITurn: Turn changed before AI could act (expected: ${civilizationId}, actual: ${this.gameEngine.activePlayer})`);
      return;
    }
    console.log(`[AI] 🤖 Starting AI turn for civilization ${civilizationId} (${civ.name})`);

    // Timing now coordinated by RoundManager; this method focuses only on AI logic

    // Small delay before AI starts so player can observe
    await this.gameEngine.sleep(250);

    const aiUnits = this.gameEngine.units.filter((u: Unit) => u.civilizationId === civilizationId && (u.movesRemaining || 0) > 0);
    console.log(`[AI] Found ${aiUnits.length} units with moves remaining for civilization ${civilizationId}`);

    for (const unit of aiUnits) {

      console.log(`[AI] Processing unit ${unit.id} (${unit.type}) at (${unit.col},${unit.row}) with ${unit.movesRemaining} moves remaining`);

      // Safety: Prevent infinite loops by limiting iterations per unit
      let movementAttempts = 0;
      const MAX_MOVEMENT_ATTEMPTS = 50; // Reasonable limit for movement attempts
      let previousMoves = unit.movesRemaining;
      let stuckCounter = 0;
      const MAX_STUCK_ITERATIONS = 3; // If moves don't change for 3 iterations, unit is stuck

      // While this unit can move, pick targets and attempt actions
      while ((unit.movesRemaining || 0) > 0) {
        movementAttempts++;

        // Check if unit is stuck (moves not decreasing)
        if (unit.movesRemaining === previousMoves) {
          stuckCounter++;
          if (stuckCounter >= MAX_STUCK_ITERATIONS) {
            console.warn(`[AI] ⚠️ Unit ${unit.id} stuck - moves not decreasing after ${stuckCounter} iterations, forcing skip`);
            this.gameEngine.skipUnit(unit.id);
            break;
          }
        } else {
          stuckCounter = 0; // Reset stuck counter if moves changed
        }
        previousMoves = unit.movesRemaining;

        if (movementAttempts > MAX_MOVEMENT_ATTEMPTS) {
          console.warn(`[AI] ⚠️ Unit ${unit.id} exceeded maximum movement attempts (${MAX_MOVEMENT_ATTEMPTS}), forcing skip`);
          this.gameEngine.skipUnit(unit.id);
          break;
        }

        const target = this.chooseAITarget(unit);
        if (!target) {
          // No valid target, skip the unit's turn
          console.log(`[AI] No target found for unit ${unit.id}, skipping`);
          this.gameEngine.skipUnit(unit.id);
          break;
        }

        // Highlight chosen target
        this.highlightAITarget(target.col, target.row);

        // Special handling for settlers: found city when at target location
        if (unit.type === 'settler' && unit.col === target.col && unit.row === target.row) {
          console.log(`[AI-SETTLER] Settler ${unit.id} has reached settlement location (${target.col}, ${target.row}), founding city`);
          const result = this.gameEngine.foundCityWithSettler(unit.id);
          if (result) {
            console.log(`[AI-SETTLER] City founded successfully`);
            break; // Settler consumed, end this unit's processing
          } else {
            console.log(`[AI-SETTLER] Failed to found city, continuing movement`);
          }
        }

        // If target is adjacent, try to move or attack
        const dist = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, target.col, target.row);
        console.log(`[AI] Target distance: ${dist} for unit ${unit.id} to (${target.col},${target.row})`);
        if (dist === 1) {
          const targetUnit = this.gameEngine.getUnitAt(target.col, target.row);
          if (targetUnit && targetUnit.civilizationId !== unit.civilizationId) {
            // Attack
            console.log(`[AI] Unit ${unit.id} attacking unit at (${target.col},${target.row})`);
            // Check move cost before attempting attack
            const tt = this.gameEngine.getTileAt(target.col, target.row);
            const attackCost = Math.max(1, tt?.movement || 1);
            if ((unit.movesRemaining || 0) >= attackCost) {
              this.gameEngine.combatUnit(unit, targetUnit);
            } else {
              console.log(`[AI] Not enough moves for attack (${unit.movesRemaining} < ${attackCost}), skipping`);
              this.gameEngine.skipUnit(unit.id);
              break;
            }
          } else {
            // Move into the tile
            const tt = this.gameEngine.getTileAt(target.col, target.row);
            const moveCost = Math.max(1, tt?.movement || 1);
            if ((unit.movesRemaining || 0) >= moveCost) {
              const r = this.gameEngine.moveUnit(unit.id, target.col, target.row);
              if (!r || !r.success) {
                console.log(`[AI] Move failed, skipping unit`);
                this.gameEngine.skipUnit(unit.id);
                break;
              }
            } else {
              console.log(`[AI] Not enough moves for move (${unit.movesRemaining} < ${moveCost}), skipping`);
              this.gameEngine.skipUnit(unit.id);
              break;
            }
          }
        } else {
          // Pathfind towards target and take next step
          console.log(`[AI] Pathfinding to non-adjacent target (${target.col},${target.row})`);
          const path = this.gameEngine.squareGrid.findPath(unit.col, unit.row, target.col, target.row, new Set());
          if (path.length > 1) {
            const next = path[1];
            console.log(`[AI] Path found, next step to (${next.col},${next.row}), path length: ${path.length}`);
            const tt = this.gameEngine.getTileAt(next.col, next.row);
            const moveCost = Math.max(1, tt?.movement || 1);
            if ((unit.movesRemaining || 0) >= moveCost) {
              const r = this.gameEngine.moveUnit(unit.id, next.col, next.row);
              if (!r || !r.success) {
                console.log(`[AI] Path step failed, skipping unit`);
                this.gameEngine.skipUnit(unit.id);
                break;
              }
            } else {
              console.log(`[AI] Not enough moves for path step (${unit.movesRemaining} < ${moveCost}), skipping`);
              this.gameEngine.skipUnit(unit.id);
              break;
            }
          } else {
            console.log(`[AI] No path found to target, skipping unit`);
            this.gameEngine.skipUnit(unit.id);
            break;
          }
        }

        // Wait a little so moves are visible
        await this.gameEngine.sleep(200);
      }
      console.log(`[AI] Finished processing unit ${unit.id}, final moves remaining: ${unit.movesRemaining}`);
    }

    console.log(`[AI] Finished all units for civilization ${civilizationId}`);
    // Emit event to clear highlights (UI decides how to handle)
    this.gameEngine.onStateChange && this.gameEngine.onStateChange('AI_CLEAR_HIGHLIGHTS', { civilizationId });

    // Process auto-production for AI cities
    console.log(`[AI] Processing auto-production for civilization ${civilizationId}`);
    this.gameEngine.autoProduction.processAutoProductionForCivilization(civilizationId);

    // Signal AI finished (for UI updates)
    console.log(`[AI] AI turn completed for civilization ${civilizationId}`);
    this.gameEngine.onStateChange && this.gameEngine.onStateChange('AI_FINISHED', { civilizationId });

    // RoundManager now responsible for evaluating end-of-turn and timeouts
  }

  /**
   * Choose a target for AI unit
   */
  private chooseAITarget(unit: any): { col: number; row: number } | null {
    if (!this.gameEngine.map || !this.gameEngine.squareGrid) return null;

    // Special handling for settlers: use SettlementEvaluator to find best city location
    if (unit.type === 'settler') {
      console.log(`[AI-SETTLER] Settler detected at (${unit.col}, ${unit.row}), using SettlementEvaluator`);

      try {
        const bestLocation = this.findBestSettlementForSettler(unit);
        if (bestLocation) {
          console.log(`[AI-SETTLER] SettlementEvaluator found best location at (${bestLocation.col}, ${bestLocation.row}) with score ${bestLocation.score}`);
          return { col: bestLocation.col, row: bestLocation.row };
        } else {
          console.log(`[AI-SETTLER] SettlementEvaluator found no suitable location, settler will explore randomly`);
        }
      } catch (error) {
        console.error(`[AI-SETTLER] Error calling SettlementEvaluator:`, error);
      }
    }

    // Phase 2.2: Special handling for warriors: target known enemy cities
    if (unit.type === 'warrior') {
      console.log(`[AI-WARRIOR] Warrior at (${unit.col}, ${unit.row}), checking for enemy targets`);

      const civData = this.gameEngine.getPlayerStorage(unit.civilizationId);
      if (civData) {
        // Get nearest enemy city from known locations
        let nearestEnemy: { col: number; row: number; enemyCivId: number } | null = null;
        let minDistance = Infinity;

        for (const [enemyCivId, enemies] of civData.enemyLocations) {
          for (const enemy of enemies) {
            if (enemy.type === 'city') {
              const dist = this.gameEngine.squareGrid.squareDistance(unit.col, unit.row, enemy.col, enemy.row);
              if (dist < minDistance) {
                minDistance = dist;
                nearestEnemy = { col: enemy.col, row: enemy.row, enemyCivId };
              }
            }
          }
        }

        if (nearestEnemy) {
          console.log(`[AI-WARRIOR] Found enemy city at (${nearestEnemy.col}, ${nearestEnemy.row}), distance: ${minDistance.toFixed(1)}`);
          return { col: nearestEnemy.col, row: nearestEnemy.row };
        } else {
          console.log(`[AI-WARRIOR] No known enemy cities, will explore`);
        }
      }

      // If no enemy city known, proceed to normal exploration below
    }

    // Special handling for scouts: use EnemySearcher to find enemies
    if (unit.type === 'scout') {
      console.log(`[AI-SCOUT] Scout detected at (${unit.col}, ${unit.row}), checking for enemies`);

      try {
        // Check if scout already found an enemy (stored in unit state)
        if (unit.enemyFound) {
          console.log(`[AI-SCOUT] Scout ${unit.id} has found enemy, returning to nearest city`);
          const nearestCity = AIUtility.findNearestOwnCity(
            unit.col,
            unit.row,
            unit.civilizationId,
            this.gameEngine.cities,
            (col1, row1, col2, row2) => this.gameEngine.squareGrid!.squareDistance(col1, row1, col2, row2)
          );
          if (nearestCity) {
            console.log(`[AI-SCOUT] Scout returning to nearest city at (${nearestCity.col}, ${nearestCity.row})`);
            return { col: nearestCity.col, row: nearestCity.row };
          }
        }

        // Phase 1: Initialize scout zones for this civilization
        this.gameEngine.assignScoutZones(unit.civilizationId);

        // Find this scout's zone index
        const scouts = this.gameEngine.units.filter((u: Unit) => u.civilizationId === unit.civilizationId && u.type === 'scout');
        const scoutIndex = scouts.findIndex(s => s.id === unit.id);
        console.log(`[AI-SCOUT] Scout ${scoutIndex + 1}/${scouts.length} searching zone ${scoutIndex}`);

        // Get visibility check function - use per-player visibility storage
        const playerStorage = this.gameEngine.getPlayerStorage(unit.civilizationId);
        const isVisible = (col: number, row: number) => {
          if (playerStorage) {
            const idx = row * this.gameEngine.map!.width + col;
            return playerStorage.visibility[idx] || playerStorage.explored[idx] || false;
          }
          // Fallback to tile visibility if storage not available
          const tile = this.gameEngine.getTileAt(col, row);
          return tile && (tile.visible || tile.explored);
        };

        // Phase 1 & 4: Search only within scout's assigned zone with performance monitoring
        const enemyResult = this.gameEngine.measurePerformance('Scout enemy search', () =>
          EnemySearcher.findNearestEnemy(
            unit.col,
            unit.row,
            this.gameEngine.map.width,
            this.gameEngine.map.height,
            (col, row) => {
              // Filter getUnitAt results to zone boundary
              if (scoutIndex >= 0 && !this.gameEngine.isInScoutZone(unit.civilizationId, scoutIndex, col, row)) return null;
              return this.gameEngine.getUnitAt(col, row);
            },
            (col, row) => {
              // Filter getCityAt results to zone boundary
              if (scoutIndex >= 0 && !this.gameEngine.isInScoutZone(unit.civilizationId, scoutIndex, col, row)) return null;
              return this.gameEngine.getCityAt(col, row);
            },
            isVisible,
            unit.civilizationId
          )
        );

        if (enemyResult) {
          console.log(`[AI-SCOUT] Enemy ${enemyResult.targetType} found at (${enemyResult.col}, ${enemyResult.row}), distance: ${enemyResult.distance}`);

          // Phase 3.3: Check if this enemy was already discovered by another scout
          const storage = this.gameEngine.getPlayerStorage(unit.civilizationId);
          let alreadyKnown = false;
          if (storage) {
            // Get enemy civilization ID
            let enemyCivId = -1;
            if (enemyResult.targetType === 'unit') {
              const unit = this.gameEngine.getUnitAt(enemyResult.col, enemyResult.row);
              if (unit) enemyCivId = unit.civilizationId;
            } else if (enemyResult.targetType === 'city') {
              const city = this.gameEngine.getCityAt(enemyResult.col, enemyResult.row);
              if (city) enemyCivId = city.civilizationId;
            }

            if (enemyCivId >= 0 && storage.enemyLocations.has(enemyCivId)) {
              const existing = storage.enemyLocations.get(enemyCivId)!.find(e => e.id === enemyResult.targetId);
              if (existing) {
                alreadyKnown = true;
                console.log(`[AI-SCOUT] Enemy ${enemyResult.targetType} at (${enemyResult.col}, ${enemyResult.row}) already known, updating last seen`);
                existing.lastSeenRound = this.gameEngine.roundManager.getRoundNumber();
              }
            }
          }

          if (!alreadyKnown) {
            // Store enemy location in player storage for civilization-wide decision making
            this.gameEngine.recordEnemyLocation(unit.civilizationId, enemyResult);

            // Mark that scout found enemy
            unit.enemyFound = true;
            unit.enemyLocation = { col: enemyResult.col, row: enemyResult.row };

            // Start returning to nearest city
            const nearestCity = AIUtility.findNearestOwnCity(
              unit.col,
              unit.row,
              unit.civilizationId,
              this.gameEngine.cities,
              (col1, row1, col2, row2) => this.gameEngine.squareGrid!.squareDistance(col1, row1, col2, row2)
            );
            if (nearestCity) {
              console.log(`[AI-SCOUT] Scout returning to nearest city at (${nearestCity.col}, ${nearestCity.row})`);
              return { col: nearestCity.col, row: nearestCity.row };
            }
          }
        } else {
          console.log(`[AI-SCOUT] No enemy found near (${unit.col}, ${unit.row}), continuing exploration`);
        }
      } catch (error) {
        console.error(`[AI-SCOUT] Error using EnemySearcher:`, error);
      }
    }

    // 1) Nearby unexplored tile
    const unexplored = AIUtility.findNearbyUnexplored(
      unit.col,
      unit.row,
      (col, row) => this.gameEngine.squareGrid!.getNeighbors(col, row),
      (col, row) => this.gameEngine.getTileAt(col, row)
    );
    if (unexplored) {
      console.log(`[AI] Chose unexplored tile at (${unexplored.col},${unexplored.row})`);
      return { col: unexplored.col, row: unexplored.row };
    }

    // Special exploration logic for scouts when no immediate unexplored tiles
    if (unit.type === 'scout') {
      const scoutExplorationTarget = this.findScoutExplorationTarget(unit);
      if (scoutExplorationTarget) {
        console.log(`[AI-SCOUT] Chose exploration target at (${scoutExplorationTarget.col},${scoutExplorationTarget.row})`);
        return { col: scoutExplorationTarget.col, row: scoutExplorationTarget.row };
      }
    }

    // 2) Nearby enemy unit
    const enemy = AIUtility.findNearbyEnemy(
      unit.col,
      unit.row,
      unit.civilizationId,
      (col, row) => this.gameEngine.squareGrid!.getNeighbors(col, row),
      (col, row) => this.gameEngine.getUnitAt(col, row)
    );
    if (enemy) {
      console.log(`[AI] Chose enemy unit at (${enemy.col},${enemy.row})`);
      return { col: enemy.col, row: enemy.row };
    }

    // 3) Choose best neighbor based on terrain cost
    console.log(`[AI] No unexplored or enemy targets found, choosing best neighbor`);

    const neighbors = this.gameEngine.squareGrid.getNeighbors(unit.col, unit.row);
    const terrainAnalysis = AIUtility.analyzeSurroundingTerrain(
      unit.col,
      unit.row,
      neighbors,
      (col, row) => this.gameEngine.getTileAt(col, row),
      (col, row) => this.gameEngine.getUnitAt(col, row),
      (col, row) => this.gameEngine.squareGrid!.isValidSquare(col, row)
    );

    if (terrainAnalysis.passableMoves.length > 0) {
      console.log(`[AI] Terrain analysis: ${terrainAnalysis.passableMoves.length} passable tiles, min cost: ${terrainAnalysis.minCost}, avg cost: ${terrainAnalysis.averageCost.toFixed(1)}`);

      const bestMove = AIUtility.chooseBestMove(terrainAnalysis);
      if (bestMove) {
        const terrainName = AIUtility.getTerrainName(bestMove.terrainType);
        console.log(`[AI] Chose best neighbor at (${bestMove.col},${bestMove.row}) - ${terrainName} (cost: ${bestMove.moveCost})`);
        return { col: bestMove.col, row: bestMove.row };
      }
    }

    console.log(`[AI] No valid target found for unit ${unit.id}`);
    return null;
  }

  /**
   * Find best settlement location for a settler
   */
  private findBestSettlementForSettler(unit: any): { col: number; row: number; score: number } | null {
    console.log(`[AI-SETTLER] Evaluating settlement locations for settler at (${unit.col}, ${unit.row})`);

    // Track position history to detect oscillation
    if (!(unit as any)._positionHistory) {
      (unit as any)._positionHistory = [];
    }
    const history = (unit as any)._positionHistory;
    const currentPos = `${unit.col},${unit.row}`;

    // Add current position to history
    history.push(currentPos);

    // Keep only last 6 positions
    if (history.length > 6) {
      history.shift();
    }

    // Detect oscillation: if we've visited the same position 3+ times in last 6 moves, we're oscillating
    const positionCounts = history.reduce((acc: Record<string, number>, pos: string) => {
      acc[pos] = (acc[pos] || 0) + 1;
      return acc;
    }, {});

    const isOscillating = Object.values(positionCounts).some((count: number) => count >= 3);

    // First, check if current location is a good settlement spot
    const currentTile = this.gameEngine.getTileAt(unit.col, unit.row);
    const currentCity = this.gameEngine.getCityAt(unit.col, unit.row);

    // Check if current position is valid for settling
    const currentPosValid = currentTile &&
        currentTile.type !== 'ocean' &&
        currentTile.type !== 'mountains' &&
        !currentCity;

    if (currentPosValid && isOscillating) {
      console.log(`[AI-SETTLER] 🔄 Oscillation detected! Position history: ${history.join(' -> ')}`);
      console.log(`[AI-SETTLER] Founding city at current location to break oscillation`);
      // Directly found city here instead of returning target
      this.gameEngine.foundCityWithSettler(unit.id);
      return null;
    }

    // Choose appropriate weights based on game state
    const weights = SettlementEvaluator.balancedGrowthWeights();
    console.log(`[AI-SETTLER] Using strategy: Balanced Growth with weights:`, weights);

    // Use SettlementEvaluator to find best location
    const bestLocation = SettlementEvaluator.findBestSettlementLocation(
      unit.col,
      unit.row,
      (col, row) => this.gameEngine.getTileAt(col, row),
      (col, row) => this.gameEngine.getCityAt(col, row),
      (col, row) => this.gameEngine.getUnitAt(col, row),
      weights,
      3, // minDistanceFromOtherCities
      unit.civilizationId,
      (col, row) => {
        // Check visibility - AI can only settle on visible tiles
        const tile = this.gameEngine.getTileAt(col, row);
        return tile && (tile.visible || tile.explored);
      },
      (fromCol, fromRow, toCol, toRow) => {
        // Check if settler can reach the location (simple path check)
        if (!this.gameEngine.squareGrid) return false;
        const path = this.gameEngine.squareGrid.findPath(fromCol, fromRow, toCol, toRow, new Set());
        return path.length > 0;
      }
    );

    if (bestLocation) {
      console.log(`[AI-SETTLER] Best settlement location found: (${bestLocation.col}, ${bestLocation.row})`);
      console.log(`[AI-SETTLER] Score: ${bestLocation.score}, Yields:`, bestLocation.yields);
      console.log(`[AI-SETTLER] Water access: ${bestLocation.hasWaterAccess}`);

      // If we have a pathfinding grid available, precompute and store a path
      try {
        if (this.gameEngine.squareGrid && this.gameEngine.roundManager) {
          const path = this.gameEngine.squareGrid.findPath(unit.col, unit.row, bestLocation.col, bestLocation.row, new Set());
          if (path && path.length > 0) {
            console.log(`[AI-SETTLER] Precomputed path for settler ${unit.id} with ${path.length} steps`);
            this.gameEngine.roundManager.setUnitPath(unit.id, path);
          } else {
            console.log(`[AI-SETTLER] No path found to best location for settler ${unit.id}`);
          }
        }
      } catch (e) {
        console.error('[AI-SETTLER] Error while precomputing path for settler:', e);
      }

      // Check if settler is already at the best location
      if (bestLocation.col === unit.col && bestLocation.row === unit.row) {
        console.log(`[AI-SETTLER] Settler is already at best location, will found city`);
        // Found city immediately
        this.gameEngine.foundCityWithSettler(unit.id);
        return null; // No need to move
      }

      // Store target to detect oscillation on next evaluation
      (unit as any)._lastSettlementTarget = { col: bestLocation.col, row: bestLocation.row };

      return bestLocation;
    }

    console.log(`[AI-SETTLER] No suitable settlement location found`);
    return null;
  }

  /**
   * Find exploration target for scouts within their zone
   */
  private findScoutExplorationTarget(unit: any): any {
    if (!this.gameEngine.map || !this.gameEngine.squareGrid) return null;

    // Get scout's zone
    const scouts = this.gameEngine.units.filter((u: Unit) => u.civilizationId === unit.civilizationId && u.type === 'scout');
    const scoutIndex = scouts.findIndex(s => s.id === unit.id);

    if (scoutIndex < 0) return null;

    const storage = this.gameEngine.getPlayerStorage(unit.civilizationId);
    if (!storage || !storage.scoutZones[scoutIndex]) return null;

    const zone = storage.scoutZones[scoutIndex];

    // Find nearest unexplored tile within the scout's zone
    let nearestUnexplored: { col: number; row: number } | null = null;
    let minDistance = Infinity;

    // Search within zone boundaries (limit search to avoid performance issues)
    const searchRadius = 10; // Search up to 10 tiles away
    const startCol = Math.max(zone.minCol, unit.col - searchRadius);
    const endCol = Math.min(zone.maxCol, unit.col + searchRadius);
    const startRow = Math.max(zone.minRow, unit.row - searchRadius);
    const endRow = Math.min(zone.maxRow, unit.row + searchRadius);

    for (let col = startCol; col < endCol; col++) {
      for (let row = startRow; row < endRow; row++) {
        // Check if tile is in zone
        if (!this.gameEngine.isInScoutZone(unit.civilizationId, scoutIndex, col, row)) continue;

        const tile = this.gameEngine.getTileAt(col, row);
        if (tile && !tile.explored) {
          const distance = Math.max(Math.abs(col - unit.col), Math.abs(row - unit.row));
          if (distance < minDistance) {
            minDistance = distance;
            nearestUnexplored = { col, row };
          }
        }
      }
    }

    if (nearestUnexplored) {
      console.log(`[AI-SCOUT] Found unexplored tile at (${nearestUnexplored.col},${nearestUnexplored.row}) in zone, distance: ${minDistance}`);
      return nearestUnexplored;
    }

    // If no unexplored tiles found in zone, move toward zone center to explore systematically
    const zoneCenterCol = Math.floor((zone.minCol + zone.maxCol) / 2);
    const zoneCenterRow = Math.floor((zone.minRow + zone.maxRow) / 2);

    // If scout is not at zone center, move toward it
    if (unit.col !== zoneCenterCol || unit.row !== zoneCenterRow) {
      // Find path toward zone center, preferring unexplored directions
      const neighbors = this.gameEngine.squareGrid.getNeighbors(unit.col, unit.row);
      let bestNeighbor: { col: number; row: number } | null = null;
      let bestDistanceToCenter = Math.max(Math.abs(unit.col - zoneCenterCol), Math.abs(unit.row - zoneCenterRow));

      for (const neighbor of neighbors) {
        if (!this.gameEngine.isInScoutZone(unit.civilizationId, scoutIndex, neighbor.col, neighbor.row)) continue;

        const tile = this.gameEngine.getTileAt(neighbor.col, neighbor.row);
        if (!tile || !tile.passable) continue;

        const distanceToCenter = Math.max(Math.abs(neighbor.col - zoneCenterCol), Math.abs(neighbor.row - zoneCenterRow));
        if (distanceToCenter < bestDistanceToCenter) {
          bestDistanceToCenter = distanceToCenter;
          bestNeighbor = neighbor;
        }
      }

      if (bestNeighbor) {
        console.log(`[AI-SCOUT] Moving toward zone center at (${zoneCenterCol},${zoneCenterRow}) via (${bestNeighbor.col},${bestNeighbor.row})`);
        return bestNeighbor;
      }
    }

    console.log(`[AI-SCOUT] No exploration targets found in zone ${scoutIndex}`);
    return null;
  }

  /**
   * Emit event for AI target highlighting
   */
  private highlightAITarget(col: number, row: number, color: string = 'rgba(255,0,0,0.4)') {
    // Emit event for UI layer to handle highlighting
    this.gameEngine.onStateChange && this.gameEngine.onStateChange('AI_TARGET_HIGHLIGHT', { col, row, color });
  }
}