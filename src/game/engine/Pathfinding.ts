import { TERRAIN_PROPS } from '../../utils/Constants';

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
   * Calculate movement cost for a tile
   */
  private static getMovementCost(
    tile: any,
    unitType: string
  ): number {
    if (!tile) return Infinity;

    // Check if tile is passable for this unit type
    const terrainProps = TERRAIN_PROPS[tile.type];

    // Determine if unit is land or water based
    const isWaterUnit = unitType === 'trireme' || unitType === 'caravel' || unitType === 'ironclad';
    const isLandUnit = !isWaterUnit;

    // Check passability
    if (terrainProps) {
      const isWaterTerrain = tile.type === 'ocean' || tile.type === 'coast' || tile.type === 'sea';

      // Land units cannot pass deep water (ocean), but can pass rivers
      if (isLandUnit && isWaterTerrain && !tile.river) {
        return Infinity; // Impassable
      }

      // Water units cannot pass land
      if (isWaterUnit && !isWaterTerrain) {
        return Infinity; // Impassable
      }

      // Base movement cost from terrain
      let cost = terrainProps.movement || 1;

      // Rivers add cost for land units
      if (isLandUnit && tile.river) {
        cost += 0.5; // Extra cost for crossing rivers
      }

      // Roads reduce cost
      if (tile.road) {
        cost = Math.max(0.5, cost - 0.5); // Roads make movement faster
      }

      // Railroads make movement free when moving between railroad tiles
      // For pathfinding, we approximate by making railroad tiles very cheap to enter
      if (tile.railroad) {
        cost = 0.2; // Very low cost for railroad tiles
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
    getTileAt: (col: number, row: number) => any,
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
   * @returns Map of "col,row" -> cost
   */
  static getReachableTiles(
    startCol: number,
    startRow: number,
    maxMovement: number,
    getTileAt: (col: number, row: number) => any,
    unitType: string,
    mapWidth: number,
    mapHeight: number
  ): Map<string, number> {
    const reachable = new Map<string, number>();
    const openSet: PathNode[] = [];
    const visited = new Set<string>();

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

        // Only add if within movement range
        if (g <= maxMovement) {
          const existingCost = reachable.get(neighborKey);
          if (existingCost === undefined || g < existingCost) {
            reachable.set(neighborKey, g);
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
