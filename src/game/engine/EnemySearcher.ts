import { Constants, TERRAIN_PROPS } from '@/utils/Constants';

export interface SearchResult {
  col: number;
  row: number;
  distance: number;
  targetType: 'unit' | 'city';
  targetId: string;
}

export interface EnemyLocation {
  col: number;
  row: number;
  type: 'unit' | 'city';
  id: string;
  discoveredRound: number;
  lastSeenRound: number;
}

/**
 * Enemy Searcher - Finds enemy units and cities using Archimedean spiral
 * 
 * Key features:
 * - Archimedean spiral pattern for efficient coverage
 * - City prioritization (cities > units)
 * - Multi-enemy tracking per civilization
 * - Scout coordination zones to avoid duplicate searching
 * - Centralized enemy location storage
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
   * Generate Archimedean spiral coordinates around a starting point
   * Spiral moves outward in a smooth pattern, optimal for searching
   * 
   * @param startCol Starting column
   * @param startRow Starting row
   * @param maxDistance Maximum spiral distance
   * @returns Generator of {col, row} coordinates in spiral order
   */
  private static *generateArchimedeanSpiral(
    startCol: number,
    startRow: number,
    maxDistance: number
  ): Generator<{ col: number; row: number }> {
    // Archimedean spiral: r = a + b*θ
    // We'll use a square spiral approximation (easier to implement, works well in grids)
    const layers = Math.ceil(maxDistance / Math.sqrt(2));
    
    for (let layer = 0; layer <= layers; layer++) {
      if (layer === 0) {
        yield { col: startCol, row: startRow };
        continue;
      }

      // Generate square ring at this layer
      const x = startCol - layer;
      const y = startRow - layer;
      const size = layer * 2;

      // Top row (left to right)
      for (let i = 0; i <= size; i++) {
        yield { col: x + i, row: y };
      }

      // Right column (top to bottom, skip corner)
      for (let i = 1; i <= size; i++) {
        yield { col: x + size, row: y + i };
      }

      // Bottom row (right to left, skip corner)
      for (let i = size - 1; i >= 0; i--) {
        yield { col: x + i, row: y + size };
      }

      // Left column (bottom to top, skip corners)
      for (let i = size - 1; i > 0; i--) {
        yield { col: x, row: y + i };
      }
    }
  }

  /**
   * Find nearest enemy with city prioritization
   * Cities are valuable targets and take precedence over units
   * 
   * @param startCol Starting column
   * @param startRow Starting row
   * @param mapWidth Map width
   * @param mapHeight Map height
   * @param getUnitAt Function to get unit at position
   * @param getCityAt Function to get city at position
   * @param isVisible Function to check if tile is visible
   * @param civilizationId Civilization ID doing the search
   * @param maxRadius Maximum search radius
   * @returns SearchResult with city-prioritized enemy, or null
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
    if (this.VERBOSE_LOGGING) {
      console.log(`[EnemySearcher] Starting search from (${startCol}, ${startRow}) for civ ${civilizationId}`);
    }

    const effectiveMaxRadius = maxRadius || Math.max(mapWidth, mapHeight);
    const visited = new Set<string>();
    
    let nearestCity: SearchResult | null = null;
    let nearestUnit: SearchResult | null = null;
    let checkedCount = 0;
    let visibleCount = 0;

    // Search in spiral order, prioritizing cities
    for (const { col, row } of this.generateArchimedeanSpiral(startCol, startRow, effectiveMaxRadius)) {
      // Bounds check
      if (col < 0 || col >= mapWidth || row < 0 || row >= mapHeight) continue;

      const key = `${col},${row}`;
      if (visited.has(key)) continue;
      visited.add(key);

      checkedCount++;

      // Only check visible tiles
      if (!this.isTileVisible(col, row, isVisible)) continue;

      visibleCount++;

      // Check for enemy city (prioritized)
      const city = getCityAt(col, row);
      if (city && city.civilizationId !== civilizationId && !nearestCity) {
        const distance = this.squareDistance(startCol, startRow, col, row);
        nearestCity = {
          col,
          row,
          distance,
          targetType: 'city',
          targetId: city.id
        };
        // Don't return yet - continue searching for other cities at same distance
        if (distance > 5) break; // City found reasonably close, stop searching
        continue;
      }

      // Check for enemy unit (secondary priority)
      const unit = getUnitAt(col, row);
      if (unit && unit.civilizationId !== civilizationId && !nearestUnit) {
        const distance = this.squareDistance(startCol, startRow, col, row);
        nearestUnit = {
          col,
          row,
          distance,
          targetType: 'unit',
          targetId: unit.id
        };
        continue;
      }

      // Stop after checking reasonable radius
      if (checkedCount > mapWidth * mapHeight * 0.5) break;
    }

    // Return city if found, otherwise unit
    const result = nearestCity || nearestUnit;
    
    if (result) {
      console.log(`[EnemySearcher] ✅ Found ${result.targetType} at (${result.col}, ${result.row}), distance: ${result.distance}`);
      if (this.VERBOSE_LOGGING) {
        console.log(`[EnemySearcher] Checked ${checkedCount} tiles, ${visibleCount} visible`);
      }
    } else {
      console.log(`[EnemySearcher] ❌ No enemy found (checked ${visibleCount}/${checkedCount} tiles)`);
    }

    return result;
  }

  /**
   * Find all enemies within a radius, sorted by distance
   * Useful for AI decision-making about threat level
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
    const enemies: SearchResult[] = [];
    const visited = new Set<string>();

    for (const { col, row } of this.generateArchimedeanSpiral(startCol, startRow, maxRadius)) {
      if (col < 0 || col >= mapWidth || row < 0 || row >= mapHeight) continue;

      const key = `${col},${row}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (!this.isTileVisible(col, row, isVisible)) continue;

      // Check city first (higher priority)
      const city = getCityAt(col, row);
      if (city && city.civilizationId !== civilizationId) {
        enemies.push({
          col,
          row,
          distance: this.squareDistance(startCol, startRow, col, row),
          targetType: 'city',
          targetId: city.id
        });
        continue;
      }

      // Check unit
      const unit = getUnitAt(col, row);
      if (unit && unit.civilizationId !== civilizationId) {
        enemies.push({
          col,
          row,
          distance: this.squareDistance(startCol, startRow, col, row),
          targetType: 'unit',
          targetId: unit.id
        });
      }
    }

    // Sort: cities first, then by distance
    enemies.sort((a, b) => {
      if (a.targetType === 'city' && b.targetType === 'unit') return -1;
      if (a.targetType === 'unit' && b.targetType === 'city') return 1;
      return a.distance - b.distance;
    });

    return enemies;
  }

  /**
   * Calculate scout assignment zones to prevent duplicate searching
   * Divides map into zones based on number of scouts
   * 
   * Each scout gets a wedge/zone to explore independently
   * Scouts coordinate by not searching each other's zones
   * 
   * @param numScouts Number of scouts in civilization
   * @param mapWidth Map width
   * @param mapHeight Map height
   * @returns Zone boundaries for each scout (index -> {minCol, maxCol, minRow, maxRow})
   */
  public static calculateScoutZones(
    numScouts: number,
    mapWidth: number,
    mapHeight: number
  ): Array<{ minCol: number; maxCol: number; minRow: number; maxRow: number }> {
    const zones: Array<{ minCol: number; maxCol: number; minRow: number; maxRow: number }> = [];

    if (numScouts <= 0) return zones;
    if (numScouts === 1) {
      zones.push({ minCol: 0, maxCol: mapWidth, minRow: 0, maxRow: mapHeight });
      return zones;
    }

    // Divide map into vertical strips (if more scouts than rows/columns available)
    if (numScouts <= mapWidth) {
      const colWidth = Math.ceil(mapWidth / numScouts);
      for (let i = 0; i < numScouts; i++) {
        zones.push({
          minCol: i * colWidth,
          maxCol: Math.min((i + 1) * colWidth, mapWidth),
          minRow: 0,
          maxRow: mapHeight
        });
      }
    } else {
      // Divide into quadrants/grid
      const sqrtScouts = Math.ceil(Math.sqrt(numScouts));
      const colWidth = Math.ceil(mapWidth / sqrtScouts);
      const rowHeight = Math.ceil(mapHeight / sqrtScouts);

      for (let row = 0; row < sqrtScouts; row++) {
        for (let col = 0; col < sqrtScouts; col++) {
          if (zones.length >= numScouts) break;
          zones.push({
            minCol: col * colWidth,
            maxCol: Math.min((col + 1) * colWidth, mapWidth),
            minRow: row * rowHeight,
            maxRow: Math.min((row + 1) * rowHeight, mapHeight)
          });
        }
      }
    }

    return zones;
  }

  /**
   * Check if a position is in scout's assigned zone
   * Scouts should prioritize their zones to coordinate
   * 
   * @param col Column position
   * @param row Row position
   * @param zone Zone boundaries
   * @returns true if position is in zone
   */
  public static isInZone(
    col: number,
    row: number,
    zone: { minCol: number; maxCol: number; minRow: number; maxRow: number }
  ): boolean {
    return col >= zone.minCol && col < zone.maxCol && row >= zone.minRow && row < zone.maxRow;
  }

  /**
   * Check if any enemy cities are visible
   * Quick check to determine if scouting is urgent
   */
  public static hasVisibleEnemyCities(
    mapWidth: number,
    mapHeight: number,
    getCityAt: (col: number, row: number) => any,
    isVisible: (col: number, row: number) => boolean,
    civilizationId: number
  ): boolean {
    for (let col = 0; col < mapWidth; col++) {
      for (let row = 0; row < mapHeight; row++) {
        if (!this.isTileVisible(col, row, isVisible)) continue;

        const city = getCityAt(col, row);
        if (city && city.civilizationId !== civilizationId) {
          return true;
        }
      }
    }
    return false;
  }
}
