import { TERRAIN_PROPS, UNIT_PROPS } from '../../utils/Constants';
import { IMPROVEMENT_PROPERTIES, IMPROVEMENT_TYPES } from '../../data/TileImprovementConstants';
import { TERRAIN_TYPES, WATER_TERRAIN_TYPES } from '../../data/TerrainConstants';
import { isRiverTile, isWideRiverTile } from './RiverRules';
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
   * Whether a unit type is naval. The unit-properties table is the source of
   * truth (so every ship, including the Ferry, is handled); the legacy list is
   * only a fallback for stubbed/synthetic unit types used in tests.
   */
  private static isNavalUnit(unitType: string): boolean {
    const normalizedType = String(unitType ?? '').trim().toLowerCase();
    const props = UNIT_PROPS[normalizedType];
    if (props) return props.naval === true;
    return ['trireme', 'caravel', 'ironclad', 'frigate', 'destroyer', 'cruiser', 'battleship', 'submarine', 'carrier', 'transport', 'sail', 'ferry']
      .includes(normalizedType);
  }

  /**
   * Check if a unit can cross a river at a given edge. Land units may only
   * enter 1-tile-wide (fordable) river sections — a 2+ wide river tile is a
   * barrier from every direction. Naval units navigate any river.
   * See `RiverRules` for the full rule and worked examples.
   */
  private static canCrossRiver(
    _fromCol: number, _fromRow: number,
    toCol: number, toRow: number,
    getTileAt: (c: number, r: number) => MapTile | null,
    unitType: string,
  ): boolean {
    const targetTile = getTileAt(toCol, toRow);
    if (!isRiverTile(targetTile)) return true;

    // Naval units can enter river tiles freely.
    if (this.isNavalUnit(unitType)) return true;

    return !isWideRiverTile(toCol, toRow, getTileAt);
  }
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
    const isWaterUnit = this.isNavalUnit(unitType);
    const isLandUnit = !isWaterUnit;

    // Check passability
    if (terrainProps) {
      // Civ1: only deep ocean is water; rivers are a land terrain type that
      // naval units may also navigate. Lakes are fresh-water obstacles and are
      // NEVER passable (for either land or naval units).
      const isLake = terrainKey === TERRAIN_TYPES.LAKE;
      if (isLake || terrainProps.passable === false && !isWaterUnit) {
        return Infinity; // Impassable
      }
      const isWaterTerrain = WATER_TERRAIN_TYPES.includes(terrainKey);

      // Land units cannot pass deep water (ocean)
      if (isLandUnit && isWaterTerrain) {
        return Infinity; // Impassable
      }

      // Water units cannot pass land — except a navigable river.
      if (isWaterUnit && !isWaterTerrain && terrainKey !== TERRAIN_TYPES.RIVER) {
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
    mapHeight: number,
    getUnitAt?: (col: number, row: number) => { civilizationId: number } | null,
    friendlyCivId?: number,
    getCityAt?: (col: number, row: number) => { civilizationId: number } | null,
    blockedTiles?: Set<string>
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

        // Caller-supplied obstacles (units/cities a settler must avoid).
        if (blockedTiles && blockedTiles.has(neighborKey)) {
          continue;
        }

        const tile = getTileAt(col, row);
        const cost = this.getMovementCost(tile, unitType);

        if (cost === Infinity) {
          continue; // Impassable
        }

        // River crossing check: land units can't cross wide rivers
        if (!this.canCrossRiver(current.col, current.row, col, row, getTileAt, unitType)) {
          continue;
        }

        // Skip tiles occupied by friendly units (can't stack).
        // The target tile is exempted — the unit needs to reach its destination.
        const isTarget = col === targetCol && row === targetRow;
        if (!isTarget && getUnitAt && friendlyCivId != null) {
          const occupant = getUnitAt(col, row);
          if (occupant && occupant.civilizationId === friendlyCivId) {
            continue; // Friendly unit blocking — path around it
          }
        }

        // Skip tiles with enemy cities (can't pass through — must attack or go around).
        // The target tile is exempted — if the destination IS an enemy city, allow it.
        if (!isTarget && getCityAt && friendlyCivId != null) {
          const city = getCityAt(col, row);
          if (city && city.civilizationId !== friendlyCivId) {
            continue; // Enemy city — path around it
          }
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
   * Get all reachable tiles within movement range.
   *
   * `unit` (optional) supplies Civ1 movement state: a fresh unit (no action
   * taken, full movement intact) may always enter its FIRST adjacent tile,
   * even when that tile's cost exceeds its remaining points.
   *
   * When `getUnitAt` is provided, tiles occupied by enemy units are still
   * included (they are attackable) but flagged with a negative cost in the
   * returned map so callers can distinguish *move* tiles from *attack* tiles.
   * Friendly-occupied tiles are excluded (can't stack except carriers).
   *
   * @returns Map of "col,row" -> cost (negative = attackable enemy tile)
   */
  static getReachableTiles(
    startCol: number,
    startRow: number,
    maxMovement: number,
    getTileAt: (col: number, row: number) => MapTile | null,
    unitType: string,
    mapWidth: number,
    mapHeight: number,
    unit?: { hasMovedThisTurn?: boolean; maxMoves?: number; civilizationId?: number },
    getUnitAt?: (col: number, row: number) => { civilizationId: number } | null
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

        // River crossing check: land units can't cross wide rivers
        if (!this.canCrossRiver(current.col, current.row, col, row, getTileAt, unitType)) {
          continue;
        }

        // --- Unit occupancy check (when getUnitAt is provided) ---
        const occupant = getUnitAt ? getUnitAt(col, row) : null;
        const isEnemy = occupant && unit && occupant.civilizationId !== unit.civilizationId;

        const g = current.g + cost;

        // Civ1 Minimum-1-Move: the FIRST step of a fresh unit is always
        // allowed, even when it costs more than the unit's remaining points.
        // Such a move spends everything, so the tile is recorded but never
        // expanded further (openSet stays ungated for it).
        const isFreshFirstStep = isFreshUnit && current.col === startCol && current.row === startRow;

        if (g <= maxMovement || isFreshFirstStep) {
          // Negative cost signals an attackable enemy tile to callers.
          const recordCost = isEnemy ? -Math.abs(g <= maxMovement ? g : maxMovement) : (g <= maxMovement ? g : maxMovement);
          const existingCost = reachable.get(neighborKey);
          if (existingCost === undefined || Math.abs(recordCost) < Math.abs(existingCost)) {
            reachable.set(neighborKey, recordCost);
          }
          // Enemy tiles are reachable (attackable) but NOT expanded further —
          // the unit stops there to fight, it doesn't path through enemies.
          if (g <= maxMovement && !isEnemy) {
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
