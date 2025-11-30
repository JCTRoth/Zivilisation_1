import { Constants, TERRAIN_PROPS } from '@/utils/Constants';

interface SearchResult {
  col: number;
  row: number;
  distance: number;
  targetType: 'unit' | 'city';
  targetId: string;
}

/**
 * Enemy Searcher - Finds enemy units and cities using hybrid spiral + row-major search
 * Optimized for medium-size maps (70x50)
 */
export class EnemySearcher {
  // Control verbosity of logging
  private static VERBOSE_LOGGING = false;

  /**
   * Check if a tile contains an enemy unit or city
   */
  private static isEnemyAt(
    col: number,
    row: number,
    getUnitAt: (col: number, row: number) => any,
    getCityAt: (col: number, row: number) => any,
    civilizationId: number
  ): SearchResult | null {
    // Check for enemy unit
    const unit = getUnitAt(col, row);
    if (unit && unit.civilizationId !== civilizationId) {
      return {
        col,
        row,
        distance: 0, // Will be calculated by caller
        targetType: 'unit',
        targetId: unit.id
      };
    }

    // Check for enemy city
    const city = getCityAt(col, row);
    if (city && city.civilizationId !== civilizationId) {
      return {
        col,
        row,
        distance: 0,
        targetType: 'city',
        targetId: city.id
      };
    }

    return null;
  }

  /**
   * Check if a tile is visible (explored by the searching civilization)
   */
  private static isTileVisible(
    col: number,
    row: number,
    isVisible: (col: number, row: number) => boolean
  ): boolean {
    try {
      return isVisible(col, row);
    } catch {
      return false;
    }
  }

  /**
   * Calculate square distance between two points
   */
  private static squareDistance(col1: number, row1: number, col2: number, row2: number): number {
    return Math.max(Math.abs(col1 - col2), Math.abs(row1 - row2));
  }

  /**
   * Find nearest enemy using hybrid spiral + row-major search
   * 
   * @param startCol Starting column position
   * @param startRow Starting row position
   * @param mapWidth Map width
   * @param mapHeight Map height
   * @param getUnitAt Function to get unit at position
   * @param getCityAt Function to get city at position
   * @param isVisible Function to check if tile is visible
   * @param civilizationId Civilization ID doing the search (to identify enemies)
   * @param maxRadius Maximum spiral search radius (default: entire map)
   * @returns SearchResult if enemy found, null otherwise
   */
  public static findNearestEnemy(
    startCol: number,
    startRow: number,
    mapWidth: number,
    mapHeight: number,
    getUnitAt: (col: number, row: number) => any,
    getCityAt: (col: number, row: number) => any,
    isVisible: (col: number, row: number) => boolean,
    civilizationId: number,
    maxRadius?: number
  ): SearchResult | null {
    console.log(`[EnemySearcher] Starting search from (${startCol}, ${startRow}) for civ ${civilizationId}`);

    const visited = new Set<string>();
    const effectiveMaxRadius = maxRadius || Math.max(mapWidth, mapHeight);
    
    let checkedTiles = 0;
    let visibleTiles = 0;

    // Phase 1: Spiral search outward from starting point
    for (let radius = 0; radius < effectiveMaxRadius; radius++) {
      // Check all tiles at this radius (edges of square)
      for (let dCol = -radius; dCol <= radius; dCol++) {
        for (let dRow = -radius; dRow <= radius; dRow++) {
          // Only check tiles on the edge of the current radius square
          if (Math.abs(dCol) !== radius && Math.abs(dRow) !== radius) continue;

          const col = startCol + dCol;
          const row = startRow + dRow;

          // Bounds check
          if (col < 0 || col >= mapWidth || row < 0 || row >= mapHeight) continue;

          const key = `${col},${row}`;
          if (visited.has(key)) continue;
          visited.add(key);

          checkedTiles++;

          // Only search visible tiles
          if (!this.isTileVisible(col, row, isVisible)) continue;

          visibleTiles++;

          // Check for enemy at this position
          const enemy = this.isEnemyAt(col, row, getUnitAt, getCityAt, civilizationId);
          if (enemy) {
            enemy.distance = this.squareDistance(startCol, startRow, col, row);
            console.log(`[EnemySearcher] ✅ Found ${enemy.targetType} at (${col}, ${row}), distance: ${enemy.distance}`);
            console.log(`[EnemySearcher] Search stats: checked ${checkedTiles} tiles (${visibleTiles} visible)`);
            return enemy;
          }
        }
      }
    }

    // Phase 2: Row-major fallback for any missed tiles
    if (this.VERBOSE_LOGGING) console.log(`[EnemySearcher] Spiral complete, starting row-major fallback`);

    for (let col = 0; col < mapWidth; col++) {
      for (let row = 0; row < mapHeight; row++) {
        const key = `${col},${row}`;
        if (visited.has(key)) continue;
        visited.add(key);

        checkedTiles++;

        if (!this.isTileVisible(col, row, isVisible)) continue;

        visibleTiles++;

        const enemy = this.isEnemyAt(col, row, getUnitAt, getCityAt, civilizationId);
        if (enemy) {
          enemy.distance = this.squareDistance(startCol, startRow, col, row);
          console.log(`[EnemySearcher] ✅ Found ${enemy.targetType} at (${col}, ${row}) via fallback, distance: ${enemy.distance}`);
          console.log(`[EnemySearcher] Search stats: checked ${checkedTiles} tiles (${visibleTiles} visible)`);
          return enemy;
        }
      }
    }

    console.log(`[EnemySearcher] ❌ No enemy found after checking ${checkedTiles} tiles (${visibleTiles} visible)`);
    return null;
  }

  /**
   * Find all enemies within a certain radius
   * 
   * @param startCol Starting column position
   * @param startRow Starting row position
   * @param mapWidth Map width
   * @param mapHeight Map height
   * @param getUnitAt Function to get unit at position
   * @param getCityAt Function to get city at position
   * @param isVisible Function to check if tile is visible
   * @param civilizationId Civilization ID doing the search
   * @param maxRadius Maximum search radius
   * @returns Array of SearchResults sorted by distance
   */
  public static findAllEnemiesInRadius(
    startCol: number,
    startRow: number,
    mapWidth: number,
    mapHeight: number,
    getUnitAt: (col: number, row: number) => any,
    getCityAt: (col: number, row: number) => any,
    isVisible: (col: number, row: number) => boolean,
    civilizationId: number,
    maxRadius: number
  ): SearchResult[] {
    console.log(`[EnemySearcher] Searching for all enemies within radius ${maxRadius} from (${startCol}, ${startRow})`);

    const enemies: SearchResult[] = [];
    const visited = new Set<string>();

    // Spiral search only (no fallback needed for radius-limited search)
    for (let radius = 0; radius <= maxRadius; radius++) {
      for (let dCol = -radius; dCol <= radius; dCol++) {
        for (let dRow = -radius; dRow <= radius; dRow++) {
          if (Math.abs(dCol) !== radius && Math.abs(dRow) !== radius) continue;

          const col = startCol + dCol;
          const row = startRow + dRow;

          if (col < 0 || col >= mapWidth || row < 0 || row >= mapHeight) continue;

          const key = `${col},${row}`;
          if (visited.has(key)) continue;
          visited.add(key);

          if (!this.isTileVisible(col, row, isVisible)) continue;

          const enemy = this.isEnemyAt(col, row, getUnitAt, getCityAt, civilizationId);
          if (enemy) {
            enemy.distance = this.squareDistance(startCol, startRow, col, row);
            enemies.push(enemy);
          }
        }
      }
    }

    // Sort by distance (closest first)
    enemies.sort((a, b) => a.distance - b.distance);

    console.log(`[EnemySearcher] Found ${enemies.length} enemies within radius ${maxRadius}`);
    return enemies;
  }

  /**
   * Check if any enemy is visible anywhere on the map
   * Quick check without finding exact location
   * 
   * @param mapWidth Map width
   * @param mapHeight Map height
   * @param getUnitAt Function to get unit at position
   * @param getCityAt Function to get city at position
   * @param isVisible Function to check if tile is visible
   * @param civilizationId Civilization ID doing the search
   * @returns true if any enemy is visible
   */
  public static hasVisibleEnemy(
    mapWidth: number,
    mapHeight: number,
    getUnitAt: (col: number, row: number) => any,
    getCityAt: (col: number, row: number) => any,
    isVisible: (col: number, row: number) => boolean,
    civilizationId: number
  ): boolean {
    for (let col = 0; col < mapWidth; col++) {
      for (let row = 0; row < mapHeight; row++) {
        if (!this.isTileVisible(col, row, isVisible)) continue;

        const enemy = this.isEnemyAt(col, row, getUnitAt, getCityAt, civilizationId);
        if (enemy) {
          return true;
        }
      }
    }
    return false;
  }
}
