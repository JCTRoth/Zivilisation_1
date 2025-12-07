import { TERRAIN_PROPS } from '@/utils/Constants';
import type { SquareCoordinate } from '../HexGrid';

/**
 * AI Utility class for intelligent movement decisions
 * Analyzes terrain around units and calculates movement costs
 */
export class AIUtility {
  /**
   * Analyze terrain around a unit and return best movement options
   */
  static analyzeSurroundingTerrain(
    unitCol: number,
    unitRow: number,
    neighbors: SquareCoordinate[],
    getTileAt: (col: number, row: number) => any,
    getUnitAt: (col: number, row: number) => any,
    isValidSquare: (col: number, row: number) => boolean
  ): TerrainAnalysis {
    const analysis: TerrainAnalysis = {
      cheapestMoves: [],
      passableMoves: [],
      allMoves: [],
      averageCost: 0,
      minCost: Infinity,
      maxCost: 0,
    };

    let totalCost = 0;
    let validCount = 0;

    for (const neighbor of neighbors) {
      if (!isValidSquare(neighbor.col, neighbor.row)) continue;

      const tile = getTileAt(neighbor.col, neighbor.row);
      if (!tile) continue;

      const terrainType = tile.type;
      const isPassable = TERRAIN_PROPS[terrainType]?.passable !== false;
      const moveCost = Math.max(1, TERRAIN_PROPS[terrainType]?.movement || 1);
      const otherUnit = getUnitAt(neighbor.col, neighbor.row);
      const isOccupied = !!otherUnit;
      const isAllyOccupied = otherUnit && otherUnit.civilizationId !== undefined; // Would be filtered by GameEngine

      const moveOption: MoveOption = {
        col: neighbor.col,
        row: neighbor.row,
        terrainType,
        moveCost,
        isPassable,
        isOccupied,
        distance: Math.max(Math.abs(neighbor.col - unitCol), Math.abs(neighbor.row - unitRow)),
      };

      analysis.allMoves.push(moveOption);

      if (isPassable && !isAllyOccupied) {
        analysis.passableMoves.push(moveOption);
        totalCost += moveCost;
        validCount++;

        // Track min/max costs
        if (moveCost < analysis.minCost) {
          analysis.minCost = moveCost;
        }
        if (moveCost > analysis.maxCost) {
          analysis.maxCost = moveCost;
        }
      }
    }

    // Find all cheapest moves
    if (analysis.minCost !== Infinity) {
      analysis.cheapestMoves = analysis.passableMoves.filter(m => m.moveCost === analysis.minCost);
    }

    // Calculate average cost
    if (validCount > 0) {
      analysis.averageCost = totalCost / validCount;
    }

    return analysis;
  }

  /**
   * Choose the best move from available options
   * Prioritizes: low cost > no occupation > not combat-oriented
   */
  static chooseBestMove(
    analysis: TerrainAnalysis,
    targetCol?: number,
    targetRow?: number
  ): MoveOption | null {
    if (analysis.passableMoves.length === 0) {
      return null;
    }

    // Prefer cheapest moves first
    if (analysis.cheapestMoves.length > 0) {
      // If there's a specific target, prefer moves closer to it
      if (targetCol !== undefined && targetRow !== undefined) {
        let bestMove = analysis.cheapestMoves[0];
        let bestDistance = Math.max(
          Math.abs(bestMove.col - targetCol),
          Math.abs(bestMove.row - targetRow)
        );

        for (const move of analysis.cheapestMoves) {
          const dist = Math.max(
            Math.abs(move.col - targetCol),
            Math.abs(move.row - targetRow)
          );
          if (dist < bestDistance) {
            bestDistance = dist;
            bestMove = move;
          }
        }
        return bestMove;
      }

      // Otherwise just pick the first cheap move
      return analysis.cheapestMoves[0];
    }

    // Fallback: pick cheapest available move
    let bestMove = analysis.passableMoves[0];
    for (const move of analysis.passableMoves) {
      if (move.moveCost < bestMove.moveCost) {
        bestMove = move;
      }
    }

    return bestMove;
  }

  /**
   * Check if unit can afford to move to a tile
   */
  static canAffordMove(
    movesRemaining: number,
    tileCost: number,
    distance: number = 1
  ): boolean {
    return movesRemaining >= tileCost * distance;
  }

  /**
   * Get terrain cost for a specific tile
   */
  static getTerrainCost(terrainType: string): number {
    return Math.max(1, TERRAIN_PROPS[terrainType]?.movement || 1);
  }

  /**
   * Get human-readable terrain name for logging
   */
  static getTerrainName(terrainType: string): string {
    const names: Record<string, string> = {
      ocean: 'Ocean',
      grassland: 'Grassland',
      forest: 'Forest',
      hills: 'Hills',
      mountains: 'Mountains',
      desert: 'Desert',
      tundra: 'Tundra',
    };
    return names[terrainType] || terrainType;
  }

  /**
   * Find nearby unexplored tile
   */
  static findNearbyUnexplored(
    unitCol: number,
    unitRow: number,
    getNeighbors: (col: number, row: number) => SquareCoordinate[],
    getTileAt: (col: number, row: number) => any
  ): SquareCoordinate | null {
    const neighbors = getNeighbors(unitCol, unitRow);
    for (const tilePos of neighbors) {
      const tile = getTileAt(tilePos.col, tilePos.row);
      if (tile && !tile.explored) {
        return tilePos;
      }
    }
    return null;
  }

  /**
   * Find nearby enemy unit
   */
  static findNearbyEnemy(
    unitCol: number,
    unitRow: number,
    unitCivilizationId: number,
    getNeighbors: (col: number, row: number) => SquareCoordinate[],
    getUnitAt: (col: number, row: number) => any
  ): any {
    const neighbors = getNeighbors(unitCol, unitRow);
    for (const tilePos of neighbors) {
      const enemyUnit = getUnitAt(tilePos.col, tilePos.row);
      if (enemyUnit && enemyUnit.civilizationId !== unitCivilizationId) {
        return enemyUnit;
      }
    }
    return null;
  }

  /**
   * Find nearest own city for a unit
   */
  static findNearestOwnCity(
    unitCol: number,
    unitRow: number,
    unitCivilizationId: number,
    cities: any[],
    squareDistance: (col1: number, row1: number, col2: number, row2: number) => number
  ): any {
    let nearestCity = null;
    let minDistance = Infinity;

    for (const city of cities) {
      if (city.civilizationId === unitCivilizationId) {
        const distance = squareDistance(unitCol, unitRow, city.col, city.row);
        if (distance < minDistance) {
          minDistance = distance;
          nearestCity = city;
        }
      }
    }

    return nearestCity;
  }
}

/**
 * Terrain analysis result
 */
export interface TerrainAnalysis {
  cheapestMoves: MoveOption[];
  passableMoves: MoveOption[];
  allMoves: MoveOption[];
  averageCost: number;
  minCost: number;
  maxCost: number;
}

/**
 * Individual move option
 */
export interface MoveOption {
  col: number;
  row: number;
  terrainType: string;
  moveCost: number;
  isPassable: boolean;
  isOccupied: boolean;
  distance: number; // Chebyshev distance from source
}

