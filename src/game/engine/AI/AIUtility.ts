import { TERRAIN_PROPS } from '@/utils/Constants';
import type { SquareCoordinate } from '../../SquareGrid';

// Type aliases for AI function parameters to avoid `any`
type TileData = { type: string; explored?: boolean; resource?: string | null; fortress?: boolean; river?: boolean; passable?: boolean };
type UnitData = { civilizationId?: number; col?: number; row?: number; attack?: number; defense?: number; id?: string; type?: string };
type CityData = { id?: string; civilizationId?: number; col?: number; row?: number };

// Cache for terrain costs to avoid repeated lookups
const terrainCostCache = new Map<string, number>();
const terrainPassableCache = new Map<string, boolean>();

/**
 * AI Utility class for intelligent movement decisions
 * Analyzes terrain around units and calculates movement costs
 * Optimized with caching and early termination
 */
export class AIUtility {
  /**
   * Get cached terrain cost
   */
  private static getCachedTerrainCost(terrainType: string): number {
    let cost = terrainCostCache.get(terrainType);
    if (cost === undefined) {
      cost = Math.max(1, TERRAIN_PROPS[terrainType]?.movement || 1);
      terrainCostCache.set(terrainType, cost);
    }
    return cost;
  }

  /**
   * Get cached terrain passability
   */
  private static getCachedPassable(terrainType: string): boolean {
    let passable = terrainPassableCache.get(terrainType);
    if (passable === undefined) {
      passable = TERRAIN_PROPS[terrainType]?.passable !== false;
      terrainPassableCache.set(terrainType, passable);
    }
    return passable;
  }

  /**
   * Calculate Chebyshev distance (optimized)
   */
  static chebyshevDistance(col1: number, row1: number, col2: number, row2: number): number {
    const dx = col1 > col2 ? col1 - col2 : col2 - col1;
    const dy = row1 > row2 ? row1 - row2 : row2 - row1;
    return dx > dy ? dx : dy;
  }

  /**
   * Analyze terrain around a unit and return best movement options
   * Optimized with single-pass analysis and early collection of cheapest moves
   */
  static analyzeSurroundingTerrain(
    unitCol: number,
    unitRow: number,
    neighbors: SquareCoordinate[],
    getTileAt: (col: number, row: number) => TileData | null | undefined,
    getUnitAt: (col: number, row: number) => UnitData | null | undefined,
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
    const neighborsLength = neighbors.length;

    // Pre-allocate arrays for better performance
    analysis.allMoves = new Array(neighborsLength);
    let allMovesIdx = 0;

    for (let i = 0; i < neighborsLength; i++) {
      const neighbor = neighbors[i];
      const { col, row } = neighbor;

      if (!isValidSquare(col, row)) continue;

      const tile = getTileAt(col, row);
      if (!tile) continue;

      const terrainType = tile.type;
      const isPassable = this.getCachedPassable(terrainType);
      const moveCost = this.getCachedTerrainCost(terrainType);
      const otherUnit = getUnitAt(col, row);
      const isOccupied = otherUnit !== null && otherUnit !== undefined;
      const isAllyOccupied = isOccupied && otherUnit.civilizationId !== undefined;

      const moveOption: MoveOption = {
        col,
        row,
        terrainType,
        moveCost,
        isPassable,
        isOccupied,
        distance: this.chebyshevDistance(col, row, unitCol, unitRow),
      };

      analysis.allMoves[allMovesIdx++] = moveOption;

      if (isPassable && !isAllyOccupied) {
        analysis.passableMoves.push(moveOption);
        totalCost += moveCost;
        validCount++;

        // Track min/max costs and collect cheapest moves in single pass
        if (moveCost < analysis.minCost) {
          analysis.minCost = moveCost;
          analysis.cheapestMoves = [moveOption];
        } else if (moveCost === analysis.minCost) {
          analysis.cheapestMoves.push(moveOption);
        }
        if (moveCost > analysis.maxCost) {
          analysis.maxCost = moveCost;
        }
      }
    }

    // Trim allMoves array
    analysis.allMoves.length = allMovesIdx;

    // Calculate average cost
    if (validCount > 0) {
      analysis.averageCost = totalCost / validCount;
    }

    return analysis;
  }

  /**
   * Choose the best move from available options
   * Prioritizes: low cost > closest to target > unoccupied
   * Optimized with early exit and reduced comparisons
   */
  static chooseBestMove(
    analysis: TerrainAnalysis,
    targetCol?: number,
    targetRow?: number
  ): MoveOption | null {
    const { passableMoves, cheapestMoves } = analysis;

    if (passableMoves.length === 0) {
      return null;
    }

    // Early exit: single option
    if (passableMoves.length === 1) {
      return passableMoves[0];
    }

    // Prefer cheapest moves first
    if (cheapestMoves.length > 0) {
      // Early exit: single cheapest option
      if (cheapestMoves.length === 1) {
        return cheapestMoves[0];
      }

      // If there's a specific target, prefer moves closer to it
      if (targetCol !== undefined && targetRow !== undefined) {
        let bestMove = cheapestMoves[0];
        let bestDistance = this.chebyshevDistance(bestMove.col, bestMove.row, targetCol, targetRow);

        const len = cheapestMoves.length;
        for (let i = 1; i < len; i++) {
          const move = cheapestMoves[i];
          const dist = this.chebyshevDistance(move.col, move.row, targetCol, targetRow);
          if (dist < bestDistance) {
            bestDistance = dist;
            bestMove = move;
            // Early exit if adjacent to target
            if (dist === 1) return bestMove;
          }
        }
        return bestMove;
      }

      // Prefer unoccupied tiles among cheapest
      for (let i = 0; i < cheapestMoves.length; i++) {
        if (!cheapestMoves[i].isOccupied) {
          return cheapestMoves[i];
        }
      }
      return cheapestMoves[0];
    }

    // Fallback: pick cheapest available move with optimized loop
    let bestMove = passableMoves[0];
    let bestCost = bestMove.moveCost;
    const len = passableMoves.length;

    for (let i = 1; i < len; i++) {
      const move = passableMoves[i];
      if (move.moveCost < bestCost) {
        bestCost = move.moveCost;
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
   * Find nearby unexplored tile.
   * Skips impassable tiles (ocean etc.) — otherwise a scout camped at the map
   * edge keeps picking an unreachable row-0 tile every turn ("Move failed to
   * (col,0)" spam) and never explores anywhere else. Unexplored state comes
   * from the per-player `isExplored` callback (AI tiles are stored per-player;
   * the global `tile.explored` is never set for AI moves).
   */
  static findNearbyUnexplored(
    unitCol: number,
    unitRow: number,
    getNeighbors: (col: number, row: number) => SquareCoordinate[],
    getTileAt: (col: number, row: number) => TileData | null | undefined,
    isPassable?: (col: number, row: number) => boolean,
    isExplored?: (col: number, row: number) => boolean
  ): SquareCoordinate | null {
    const neighbors = getNeighbors(unitCol, unitRow);
    // Civ1 exploration randomness: shuffle the scan order so the direction a
    // unit first steps into unexplored territory is not fixed by grid ordering
    // (the old code always tried the same neighbor first, so every unit drifted
    // the same way). The first unexplored, passable neighbor now varies.
    for (let i = neighbors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [neighbors[i], neighbors[j]] = [neighbors[j], neighbors[i]];
    }
    for (const tilePos of neighbors) {
      const tile = getTileAt(tilePos.col, tilePos.row);
      if (!tile) continue;
      const explored = isExplored ? isExplored(tilePos.col, tilePos.row) : !!tile.explored;
      if (explored) continue;
      // Never send a unit onto an impassable tile (row-0 ocean, mountains…).
      if (isPassable && !isPassable(tilePos.col, tilePos.row)) continue;
      return tilePos;
    }
    return null;
  }

  /**
   * Random exploration target within a local frontier band.
   *
   * Sorts the candidates by distance and picks a weighted-random tile from the
   * nearest `bandSize` (so exploration stays local instead of teleport-targeting
   * a far corner), with closer and bearing-aligned tiles weighted higher and a
   * random jitter on every pick. Pure "nearest" made every unit stream to the
   * same frontier; this fans units out in varied directions.
   *
   * @param unit      The exploring unit (for relative bearing alignment).
   * @param candidates Unexplored, passable target tiles with their distance.
   * @param bearing   The unit's random exploration heading (dx/dy in {-1,0,1});
   *                  tiles lying along it are preferred but never forced.
   * @param bandSize  How many of the nearest candidates compete (default 8).
   */
  static pickRandomExplorationTarget<T extends { col: number; row: number; dist: number }>(
    unit: { col: number; row: number },
    candidates: T[],
    bearing: { dx: number; dy: number } | null,
    bandSize = 8,
  ): T | null {
    if (!candidates || candidates.length === 0) return null;
    candidates.sort((a, b) => a.dist - b.dist);
    const band = candidates.slice(0, Math.min(bandSize, candidates.length));
    if (band.length === 1) return band[0];

    const weights = band.map((c) => {
      // Bearing alignment: 1 when the tile lies along the unit's heading,
      // 0.5 when perpendicular, 0 when directly behind.
      let align = 0.5;
      if (bearing) {
        const toX = Math.sign(c.col - unit.col);
        const toY = Math.sign(c.row - unit.row);
        align = (bearing.dx * toX + bearing.dy * toY + 2) / 4;
      }
      const distWeight = 1 / (1 + c.dist);
      // Random jitter keeps every pick uncertain even among equal-distance tiles.
      return distWeight * (0.3 + 0.7 * align) + Math.random();
    });

    let total = 0;
    for (const w of weights) total += w;
    let r = Math.random() * total;
    for (let i = 0; i < band.length; i++) {
      r -= weights[i];
      if (r <= 0) return band[i];
    }
    return band[band.length - 1];
  }

  /**
   * Find nearby enemy unit
   */
  static findNearbyEnemy(
    unitCol: number,
    unitRow: number,
    unitCivilizationId: number,
    getNeighbors: (col: number, row: number) => SquareCoordinate[],
    getUnitAt: (col: number, row: number) => UnitData | null | undefined
  ): UnitData | null {
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
   * Optimized with early exit for adjacent cities and pre-filtering
   */
  static findNearestOwnCity(
    unitCol: number,
    unitRow: number,
    unitCivilizationId: number,
    cities: CityData[],
    squareDistance?: (col1: number, row1: number, col2: number, row2: number) => number
  ): CityData | null {
    if (!cities || cities.length === 0) return null;

    // Use internal distance function if not provided
    const distFn = squareDistance || this.chebyshevDistance;

    let nearestCity = null;
    let minDistance = Infinity;
    const citiesLen = cities.length;

    for (let i = 0; i < citiesLen; i++) {
      const city = cities[i];
      if (city.civilizationId !== unitCivilizationId) continue;

      const distance = distFn(unitCol, unitRow, city.col, city.row);

      // Early exit: if distance is 0 or 1, we're at or adjacent to a city
      if (distance <= 1) {
        return city;
      }

      if (distance < minDistance) {
        minDistance = distance;
        nearestCity = city;
      }
    }

    return nearestCity;
  }

  /**
   * Calculate threat level at a position based on nearby enemies
   * Useful for defensive positioning and retreat decisions
   */
  static calculateThreatLevel(
    col: number,
    row: number,
    civilizationId: number,
    getUnitsInRadius: (col: number, row: number, radius: number) => UnitData[],
    radius: number = 3
  ): number {
    const nearbyUnits = getUnitsInRadius(col, row, radius);
    let threat = 0;

    for (const unit of nearbyUnits) {
      if (unit.civilizationId !== civilizationId) {
        const distance = this.chebyshevDistance(col, row, unit.col, unit.row);
        // Threat decreases with distance, combat units are more threatening
        const unitThreat = (unit.attack || 1) / (distance + 1);
        threat += unitThreat;
      }
    }

    return threat;
  }

  /**
   * Evaluate strategic value of a position
   * Considers terrain, resources, and tactical advantage
   */
  static evaluatePosition(
    col: number,
    row: number,
    getTileAt: (col: number, row: number) => TileData | null | undefined,
    _civilizationId: number,
    _getCityAt?: (col: number, row: number) => CityData | null | undefined
  ): number {
    const tile = getTileAt(col, row);
    if (!tile) return 0;

    let value = 0;

    // Base terrain value
    const props = TERRAIN_PROPS[tile.type];
    if (props) {
      value += (props.food || 0) * 2 + (props.production || 0) * 1.5 + (props.trade || 0);
    }

    // Defensive bonus for hills/forests
    if (tile.type === 'hills' || tile.type === 'forest') {
      value += 2;
    }

    // Resource bonus
    if (tile.resource) {
      value += 5;
    }

    // Strategic position near water (rivers are a Civ1 terrain type)
    if (tile.type === 'river') {
      value += 1;
    }

    return value;
  }

  /**
   * Find best defensive position within range
   */
  static findBestDefensivePosition(
    _unitCol: number,
    _unitRow: number,
    neighbors: SquareCoordinate[],
    getTileAt: (col: number, row: number) => TileData | null | undefined,
    getUnitAt: (col: number, row: number) => UnitData | null | undefined,
    isValidSquare: (col: number, row: number) => boolean
  ): SquareCoordinate | null {
    let bestPosition: SquareCoordinate | null = null;
    let bestDefenseValue = -Infinity;

    for (const neighbor of neighbors) {
      if (!isValidSquare(neighbor.col, neighbor.row)) continue;

      const tile = getTileAt(neighbor.col, neighbor.row);
      if (!tile) continue;

      const isPassable = this.getCachedPassable(tile.type);
      if (!isPassable) continue;

      const otherUnit = getUnitAt(neighbor.col, neighbor.row);
      if (otherUnit) continue;

      let defenseValue = 0;

      // Hills provide best defense
      if (tile.type === 'hills') defenseValue += 4;
      else if (tile.type === 'forest') defenseValue += 2;
      else if (tile.type === 'mountains') defenseValue += 3;

      // Fortification bonus
      if (tile.fortress) defenseValue += 5;

      if (defenseValue > bestDefenseValue) {
        bestDefenseValue = defenseValue;
        bestPosition = neighbor;
      }
    }

    return bestPosition;
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

/**
 * Threat alert broadcast when a unit detects nearby enemies.
 * Used to rally nearby allied combat units.
 */
export interface ThreatAlert {
  col: number;
  row: number;
  enemyStrength: number;
  /** Round the alert was issued */
  round: number;
}

/**
 * Scan a wider radius (up to `radius` tiles) for enemies.
 * Returns all enemy units/cities found, sorted by distance.
 */
export function scanAreaForEnemies(
  centerCol: number,
  centerRow: number,
  civilizationId: number,
  radius: number,
  getUnits: () => Array<{ id: string; col: number; row: number; civilizationId: number; attack?: number; defense?: number; type: string }>,
  getCities: () => Array<{ id: string; col: number; row: number; civilizationId: number }>,
  distanceFn: (c1: number, r1: number, c2: number, r2: number) => number
): Array<{ col: number; row: number; type: 'unit' | 'city'; distance: number; strength: number; id: string }> {
  const results: Array<{ col: number; row: number; type: 'unit' | 'city'; distance: number; strength: number; id: string }> = [];

  for (const unit of getUnits()) {
    if (unit.civilizationId === civilizationId) continue;
    const dist = distanceFn(centerCol, centerRow, unit.col, unit.row);
    if (dist <= radius) {
      results.push({
        col: unit.col,
        row: unit.row,
        type: 'unit',
        distance: dist,
        strength: Math.max(1, unit.attack || 0) + (unit.defense || 0) * 0.5,
        id: unit.id,
      });
    }
  }

  for (const city of getCities()) {
    if (city.civilizationId === civilizationId) continue;
    const dist = distanceFn(centerCol, centerRow, city.col, city.row);
    if (dist <= radius) {
      results.push({
        col: city.col,
        row: city.row,
        type: 'city',
        distance: dist,
        strength: 5,
        id: city.id,
      });
    }
  }

  results.sort((a, b) => a.distance - b.distance);
  return results;
}

/**
 * Evaluate the defensive quality of a tile for positioning.
 * Higher is better. Hills > Forest > Plains.
 */
function evaluateDefensiveTerrain(tile: { type?: string; fortress?: boolean; river?: boolean } | null): number {
  if (!tile) return 0;
  let score = 0;
  if (tile.type === 'hills') score += 4;
  else if (tile.type === 'forest') score += 2;
  else if (tile.type === 'mountains') score += 3;
  if (tile.fortress) score += 5;
  if (tile.river) score += 1;
  return score;
}

/**
 * Find the best tile to move toward when intercepting enemies,
 * preferring defensive terrain between our position and the threat.
 */
export function findInterceptPosition(
  unitCol: number,
  unitRow: number,
  threatCol: number,
  threatRow: number,
  getNeighbors: (col: number, row: number) => SquareCoordinate[],
  getTileAt: (col: number, row: number) => TileData | null | undefined,
  getUnitAt: (col: number, row: number) => UnitData | null | undefined,
  distanceFn: (c1: number, r1: number, c2: number, r2: number) => number
): SquareCoordinate | null {
  const neighbors = getNeighbors(unitCol, unitRow);
  let best: SquareCoordinate | null = null;
  let bestScore = -Infinity;

  for (const n of neighbors) {
    const tile = getTileAt(n.col, n.row);
    if (!tile || !tile.passable) continue;
    const occupant = getUnitAt(n.col, n.row);
    if (occupant) continue;

    const distToThreat = distanceFn(n.col, n.row, threatCol, threatRow);
    const currentDist = distanceFn(unitCol, unitRow, threatCol, threatRow);

    // Prefer tiles that move closer to (or stay same distance from) the threat
    const closingBonus = (currentDist - distToThreat) * 3;
    const defenseBonus = evaluateDefensiveTerrain(tile);

    const score = closingBonus + defenseBonus;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }

  return best;
}

/**
 * Idle military units hold position. There is no active "patrol" target:
 * every version of one (circling the capital, marching to the midpoint
 * between cities, being recalled to the capital) sent units marching at a
 * tile they could NOT enter — their own city — so they bounced back and
 * forth forever ("units walk up and down"). Idle units get real missions
 * from the combat / alert / strategic / probe / village branches; when none
 * apply the correct behaviour is to stay put and defend.
 */
export function findPatrolWaypoint(
  _unit: UnitData,
  _unitCol: number,
  _unitRow: number,
  _cities: Array<{ col: number; row: number; civilizationId: number }>,
  _civilizationId: number,
  _distanceFn: (c1: number, r1: number, c2: number, r2: number) => number
): { col: number; row: number } | null {
  return null;
}

