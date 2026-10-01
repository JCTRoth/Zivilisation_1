import { debugLog } from '../../utils/DevLog';

export interface SearchResult {
  col: number;
  row: number;
  distance: number;
  targetType: 'unit' | 'city';
  targetId: string;
  priority: number; // Higher = more important target
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
 * Min-heap for efficient enemy prioritization
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

  // _isEnemyAt removed (unused)

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
   * Calculate square distance between two points (Chebyshev distance)
   * Optimized with bitwise abs
   */
  private static squareDistance(col1: number, row1: number, col2: number, row2: number): number {
    const dx = col1 - col2;
    const dy = row1 - row2;
    const absDx = dx < 0 ? -dx : dx;
    const absDy = dy < 0 ? -dy : dy;
    return absDx > absDy ? absDx : absDy;
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
   * Optimized with early termination and efficient spiral search
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
    getUnitAt: (col: number, row: number) => { id: string; civilizationId: number; col: number; row: number } | null | undefined,
    getCityAt: (col: number, row: number) => { id: string; civilizationId: number; col: number; row: number } | null | undefined,
    isVisible: (col: number, row: number) => boolean,
    civilizationId: number,
    maxRadius?: number
  ): SearchResult | null {
    if (this.VERBOSE_LOGGING) {
      debugLog(`[EnemySearcher] Starting search from (${startCol}, ${startRow}) for civ ${civilizationId}`);
    }

    const effectiveMaxRadius = maxRadius || Math.max(mapWidth, mapHeight);
    
    // Use a more efficient visited tracking with bit operations
    const visited = new Uint8Array((mapWidth * mapHeight + 7) >> 3);
    const setVisited = (col: number, row: number): void => {
      const idx = row * mapWidth + col;
      visited[idx >> 3] |= 1 << (idx & 7);
    };
    const isVisited = (col: number, row: number): boolean => {
      const idx = row * mapWidth + col;
      return (visited[idx >> 3] & (1 << (idx & 7))) !== 0;
    };
    
    let nearestCity: SearchResult | null = null;
    let nearestUnit: SearchResult | null = null;
    let nearestCityDistance = Infinity;
    let nearestUnitDistance = Infinity;
    let checkedCount = 0;
    let visibleCount = 0;

    // Early termination thresholds
    const EARLY_CITY_THRESHOLD = 3; // If we find a city this close, stop searching
    const MAX_SEARCH_TILES = Math.min(mapWidth * mapHeight * 0.3, 5000); // Limit search

    // Search in spiral order, prioritizing cities
    for (const { col, row } of this.generateArchimedeanSpiral(startCol, startRow, effectiveMaxRadius)) {
      // Early termination if we've found a close enough city
      if (nearestCity && nearestCityDistance <= EARLY_CITY_THRESHOLD) {
        break;
      }

      // Stop if we've searched too many tiles
      if (checkedCount > MAX_SEARCH_TILES) {
        break;
      }

      // Bounds check (inline for performance)
      if (col < 0 || col >= mapWidth || row < 0 || row >= mapHeight) continue;

      if (isVisited(col, row)) continue;
      setVisited(col, row);

      checkedCount++;

      // Only check visible tiles
      if (!this.isTileVisible(col, row, isVisible)) continue;

      visibleCount++;

      const distance = this.squareDistance(startCol, startRow, col, row);

      // Skip if farther than current best city (cities are priority)
      if (nearestCity && distance > nearestCityDistance) continue;

      // Check for enemy city (prioritized)
      const city = getCityAt(col, row);
      if (city && city.civilizationId !== civilizationId) {
        if (distance < nearestCityDistance) {
          nearestCityDistance = distance;
          nearestCity = {
            col,
            row,
            distance,
            targetType: 'city',
            targetId: city.id,
            priority: 100 - distance // Higher priority for closer cities
          };
          // Early exit if very close
          if (distance <= EARLY_CITY_THRESHOLD) break;
        }
        continue;
      }

      // Check for enemy unit (secondary priority)
      // Only if no nearby city found
      if (!nearestCity || distance < nearestCityDistance) {
        const unit = getUnitAt(col, row);
        if (unit && unit.civilizationId !== civilizationId && distance < nearestUnitDistance) {
          nearestUnitDistance = distance;
          nearestUnit = {
            col,
            row,
            distance,
            targetType: 'unit',
            targetId: unit.id,
            priority: 50 - distance // Lower priority than cities
          };
        }
      }
    }

    // Return city if found, otherwise unit
    const result = nearestCity || nearestUnit;
    
    if (result) {
      debugLog(`[EnemySearcher] ✅ Found ${result.targetType} at (${result.col}, ${result.row}), distance: ${result.distance}`);
      if (this.VERBOSE_LOGGING) {
        debugLog(`[EnemySearcher] Checked ${checkedCount} tiles, ${visibleCount} visible`);
      }
    } else if (this.VERBOSE_LOGGING) {
      debugLog(`[EnemySearcher] ❌ No enemy found (checked ${visibleCount}/${checkedCount} tiles)`);
    }

    return result;
  }

  /**
   * Find all enemies within a radius, sorted by distance and priority
   * Useful for AI decision-making about threat level
   * Optimized with efficient data structures
   */
  public static findAllEnemiesInRadius(
    startCol: number,
    startRow: number,
    mapWidth: number,
    mapHeight: number,
    getUnitAt: (col: number, row: number) => { id: string; civilizationId: number; col: number; row: number } | null | undefined,
    getCityAt: (col: number, row: number) => { id: string; civilizationId: number; col: number; row: number } | null | undefined,
    isVisible: (col: number, row: number) => boolean,
    civilizationId: number,
    maxRadius: number
  ): SearchResult[] {
    // Pre-allocate with estimated capacity
    const cities: SearchResult[] = [];
    const units: SearchResult[] = [];
    
    // Use efficient visited tracking
    const visited = new Uint8Array((mapWidth * mapHeight + 7) >> 3);
    const setVisited = (col: number, row: number): void => {
      const idx = row * mapWidth + col;
      visited[idx >> 3] |= 1 << (idx & 7);
    };
    const isVisited = (col: number, row: number): boolean => {
      const idx = row * mapWidth + col;
      return (visited[idx >> 3] & (1 << (idx & 7))) !== 0;
    };

    for (const { col, row } of this.generateArchimedeanSpiral(startCol, startRow, maxRadius)) {
      if (col < 0 || col >= mapWidth || row < 0 || row >= mapHeight) continue;

      if (isVisited(col, row)) continue;
      setVisited(col, row);

      if (!this.isTileVisible(col, row, isVisible)) continue;

      const distance = this.squareDistance(startCol, startRow, col, row);

      // Check city first (higher priority)
      const city = getCityAt(col, row);
      if (city && city.civilizationId !== civilizationId) {
        cities.push({
          col,
          row,
          distance,
          targetType: 'city',
          targetId: city.id,
          priority: 100 - distance
        });
        continue;
      }

      // Check unit
      const unit = getUnitAt(col, row);
      if (unit && unit.civilizationId !== civilizationId) {
        units.push({
          col,
          row,
          distance,
          targetType: 'unit',
          targetId: unit.id,
          priority: 50 - distance
        });
      }
    }

    // Sort cities by distance, then units by distance
    cities.sort((a, b) => a.distance - b.distance);
    units.sort((a, b) => a.distance - b.distance);

    // Return cities first, then units (pre-sorted)
    return cities.concat(units);
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
    getCityAt: (col: number, row: number) => { id: string; civilizationId: number; col: number; row: number } | null | undefined,
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
