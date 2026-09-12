import { TERRAIN_PROPS } from '../../utils/Constants';
import { IMPROVEMENT_PROPERTIES, IMPROVEMENT_TYPES } from '../../data/TileImprovementConstants';
import type { MapTile } from './GameEngine';

/**
 * Node for A* pathfinding
 */
interface PathNode {
  col: number;
  row: number;
  g: number; // Cost from start to this node
  h: number; // Heuristic cost to target
  f: number; // Total cost (g + h)
  parent: PathNode | null;
}

/**
 * Path result
 */
export interface PathResult {
  path: { col: number; row: number }[];
  totalCost: number;
  success: boolean;
}

/**
 * A* Pathfinding for unit movement
 */
export class Pathfinding {
  /**
   * Calculate movement cost for a tile.
   *
   * Public so UI previews (hover path + turn markers) reuse the exact same cost
   * model as the engine (roads = 1/3, railroads ~0.05, ocean impassable to land).
   */
  static getMovementCost(
    tile: MapTile,
    unitType: string
  ): number {
    if (!tile) return Infinity;

    const terrainKey = String(tile.type ?? tile.terrain ?? '').trim().toLowerCase();

    // Check if tile is passable for this unit type
    const terrainProps = TERRAIN_PROPS[terrainKey];

    // Determine if unit is land or water based
    const normalizedType = String(unitType ?? '').trim().toLowerCase();
    const isWaterUnit = ['trireme', 'caravel', 'ironclad', 'frigate', 'destroyer', 'cruiser', 'battleship', 'submarine', 'carrier', 'transport', 'sail'].includes(normalizedType);
    const isLandUnit = !isWaterUnit;

    // Check passability
    if (terrainProps) {
      // Civ1: only deep ocean is water; rivers are a land terrain type.
      const isWaterTerrain = terrainKey === 'ocean' || terrainKey === 'sea';

      // Land units cannot pass deep water (ocean)
      if (isLandUnit && isWaterTerrain) {
        return Infinity; // Impassable
      }

      // Water units cannot pass land
      if (isWaterUnit && !isWaterTerrain) {
        return Infinity; // Impassable
      }

      // Base movement cost from terrain (Civ1-paced: 1/2/3).
      let cost = terrainProps.movement || 1;

      // Civ1 rivers give no movement penalty (unlike Civ2).

      // Civ1: moving onto a road tile costs 1/3 of a movement point.
      if (tile.road || tile.improvement === IMPROVEMENT_TYPES.ROAD) {
        cost = IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.ROAD]?.movementCost ?? 1 / 3;
      }

      // Civ1: railroads make movement between railroad tiles free (tiny epsilon for A*).
      if (tile.railroad || tile.improvement === IMPROVEMENT_TYPES.RAILROAD) {
        cost = IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.RAILROAD]?.movementCost ?? 0.05;
      }

      return cost;
    }

    return 1; // Default cost
  }

  /**
   * Heuristic for A* (Manhattan distance)
   */
  private static heuristic(col1: number, row1: number, col2: number, row2: number): number {
    return Math.abs(col1 - col2) + Math.abs(row1 - row2);
  }

  /**
   * Find path using A* algorithm
   */
  static findPath(
    startCol: number,
    startRow: number,
    targetCol: number,
    targetRow: number,
    getTileAt: (col: number, row: number) => MapTile | null,
    unitType: string,
    mapWidth: number,
    mapHeight: number
  ): PathResult {
    const openSet: PathNode[] = [];
    const closedSet = new Set<string>();

    const startNode: PathNode = {
      col: startCol,
      row: startRow,
      g: 0,
      h: this.heuristic(startCol, startRow, targetCol, targetRow),
      f: 0,
      parent: null
    };
    startNode.f = startNode.g + startNode.h;
    openSet.push(startNode);

    const nodeMap = new Map<string, PathNode>();
    nodeMap.set(`${startCol},${startRow}`, startNode);

    while (openSet.length > 0) {
      // Find node with lowest f cost
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift()!;
      const currentKey = `${current.col},${current.row}`;

      if (current.col === targetCol && current.row === targetRow) {
        // Reconstruct path
        const path: { col: number; row: number }[] = [];
        let node: PathNode | null = current;
        while (node) {
          path.unshift({ col: node.col, row: node.row });
          node = node.parent;
        }
        return {
          path,
          totalCost: current.g,
          success: true
        };
      }

      closedSet.add(currentKey);

      // Check neighbors (6 directions for hex grid, but using square for simplicity)
      const neighbors = [
        { col: current.col - 1, row: current.row },
        { col: current.col + 1, row: current.row },
        { col: current.col, row: current.row - 1 },
        { col: current.col, row: current.row + 1 },
        { col: current.col - 1, row: current.row - 1 },
        { col: current.col + 1, row: current.row + 1 },
        { col: current.col - 1, row: current.row + 1 },
        { col: current.col + 1, row: current.row - 1 }
      ];

      for (const neighbor of neighbors) {
        const { col, row } = neighbor;

        // Check bounds
        if (col < 0 || col >= mapWidth || row < 0 || row >= mapHeight) {
          continue;
        }

        const neighborKey = `${col},${row}`;
        if (closedSet.has(neighborKey)) {
          continue;
        }

        const tile = getTileAt(col, row);
        const cost = this.getMovementCost(tile, unitType);

        if (cost === Infinity) {
          continue; // Impassable
        }

        const g = current.g + cost;
        const h = this.heuristic(col, row, targetCol, targetRow);
        const f = g + h;

        let neighborNode = nodeMap.get(neighborKey);
        if (!neighborNode) {
          neighborNode = {
            col,
            row,
            g,
            h,
            f,
            parent: current
          };
          nodeMap.set(neighborKey, neighborNode);
          openSet.push(neighborNode);
        } else if (g < neighborNode.g) {
          // Better path found
          neighborNode.g = g;
          neighborNode.f = f;
          neighborNode.parent = current;
        }
      }
    }

    // No path found
    return {
      path: [],
      totalCost: 0,
      success: false
    };
  }

  /**
   * Get all reachable tiles within movement range
   * `unit` (optional) supplies Civ1 movement state: a fresh unit (no action
   * taken, full movement intact) may always enter its FIRST adjacent tile,
   * even when that tile's cost exceeds its remaining points.
   * @returns Map of "col,row" -> cost
   */
  static getReachableTiles(
    startCol: number,
    startRow: number,
    maxMovement: number,
    getTileAt: (col: number, row: number) => MapTile | null,
    unitType: string,
    mapWidth: number,
    mapHeight: number,
    unit?: { hasMovedThisTurn?: boolean; maxMoves?: number }
  ): Map<string, number> {
    const reachable = new Map<string, number>();
    const openSet: PathNode[] = [];
    const visited = new Set<string>();

    // Civ1 "Minimum 1 Move": the exception applies only while the unit is
    // fresh (no action this turn and moves_current == moves_max).
    const movesMax = unit && typeof unit.maxMoves === 'number' ? unit.maxMoves : maxMovement;
    const isFreshUnit = unit ? (unit.hasMovedThisTurn !== true && maxMovement >= movesMax) : false;

    const startNode: PathNode = {
      col: startCol,
      row: startRow,
      g: 0,
      h: 0,
      f: 0,
      parent: null
    };
    openSet.push(startNode);
    reachable.set(`${startCol},${startRow}`, 0);

    while (openSet.length > 0) {
      openSet.sort((a, b) => a.g - b.g);
      const current = openSet.shift()!;
      const currentKey = `${current.col},${current.row}`;

      if (visited.has(currentKey)) continue;
      visited.add(currentKey);

      // Check neighbors
      const neighbors = [
        { col: current.col - 1, row: current.row },
        { col: current.col + 1, row: current.row },
        { col: current.col, row: current.row - 1 },
        { col: current.col, row: current.row + 1 },
        { col: current.col - 1, row: current.row - 1 },
        { col: current.col + 1, row: current.row + 1 },
        { col: current.col - 1, row: current.row + 1 },
        { col: current.col + 1, row: current.row - 1 }
      ];

      for (const neighbor of neighbors) {
        const { col, row } = neighbor;

        // Check bounds
        if (col < 0 || col >= mapWidth || row < 0 || row >= mapHeight) {
          continue;
        }

        const neighborKey = `${col},${row}`;
        if (visited.has(neighborKey)) {
          continue;
        }

        const tile = getTileAt(col, row);
        const cost = this.getMovementCost(tile, unitType);

        if (cost === Infinity) {
          continue; // Impassable
        }

        const g = current.g + cost;

        // Civ1 Minimum-1-Move: the FIRST step of a fresh unit is always
        // allowed, even when it costs more than the unit's remaining points.
        // Such a move spends everything, so the tile is recorded but never
        // expanded further (openSet stays ungated for it).
        const isFreshFirstStep = isFreshUnit && current.col === startCol && current.row === startRow;

        if (g <= maxMovement || isFreshFirstStep) {
          const recordCost = g <= maxMovement ? g : maxMovement;
          const existingCost = reachable.get(neighborKey);
          if (existingCost === undefined || recordCost < existingCost) {
            reachable.set(neighborKey, recordCost);
          }
          if (g <= maxMovement) {
            openSet.push({
              col,
              row,
              g,
              h: 0,
              f: g,
              parent: current
            });
          }
        }
      }
    }

    // Remove starting position
    reachable.delete(`${startCol},${startRow}`);
    return reachable;
  }
}
