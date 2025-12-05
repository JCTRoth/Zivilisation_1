import {Constants, TERRAIN_PROPS} from '@/utils/Constants';

interface TileYields {
  food: number;
  shields: number;
  gold: number;
}

interface SettlementWeights {
  food_weight: number;
  shields_weight: number;
  gold_weight: number;
}

interface SettlementScore {
  col: number;
  row: number;
  score: number;
  yields: TileYields;
  hasWaterAccess: boolean;
}

/**
 * Settlement Evaluator - Determines optimal city placement locations
 */
export class SettlementEvaluator {
  // Control verbosity of logging (set to false to reduce console spam during AI turns)
  private static VERBOSE_LOGGING = false;
  
  /**
   * Get tile yields based on terrain type
   */
  private static getTileYields(terrainType: string): TileYields {
    const props = TERRAIN_PROPS[terrainType];
    if (!props) {
      console.warn(`[SettlementEvaluator] getTileYields: Unknown terrain type '${terrainType}', returning zero yields`);
      return { food: 0, shields: 0, gold: 0 };
    }

    const yields = {
      food: props.food || 0,
      shields: props.production || 0,
      gold: props.trade || 0
    };

    // console.log(`[SettlementEvaluator] getTileYields: Terrain '${terrainType}' => food:${yields.food}, shields:${yields.shields}, gold:${yields.gold}`);
    return yields;
  }

  /**
   * Check if a tile is water (ocean or coast)
   */
  private static isWaterTile(terrainType: string): boolean {
    return terrainType === Constants.TERRAIN.OCEAN || terrainType === 'coast' || terrainType === 'sea';
  }

  /**
   * Check if location has water access (adjacent to water or on water)
   */
  private static hasWaterAccess(
    col: number,
    row: number,
    getTileAt: (col: number, row: number) => any
  ): boolean {
    if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] hasWaterAccess: Checking water access at (${col}, ${row})`);

    // Check if the tile itself is water
    const centerTile = getTileAt(col, row);
    if (centerTile && this.isWaterTile(centerTile.type)) {
      if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] hasWaterAccess: ✓ Center tile IS water (${centerTile.type})`);
      return true;
    }

    // Check all adjacent tiles (8 neighbors)
    const neighbors = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0],           [1, 0],
      [-1, 1],  [0, 1],  [1, 1]
    ];

    for (const [dx, dy] of neighbors) {
      const tile = getTileAt(col + dx, row + dy);
      if (tile && this.isWaterTile(tile.type)) {
        if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] hasWaterAccess: ✓ Found water at adjacent tile (${col + dx}, ${row + dy}) - ${tile.type}`);
        return true;
      }
    }

    if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] hasWaterAccess: ✗ No water access found`);
    return false;
  }

  /**
   * Evaluate a 3x3 area around a potential settlement location
   */
  private static evaluateArea(
    centerCol: number,
    centerRow: number,
    getTileAt: (col: number, row: number) => any,
    weights: SettlementWeights
  ): number {
    if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] evaluateArea: Evaluating 3x3 area around (${centerCol}, ${centerRow}) with weights:`, weights);

    let totalFood = 0;
    let totalShields = 0;
    let totalGold = 0;

    // Evaluate 3x3 area around the center
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const col = centerCol + dx;
        const row = centerRow + dy;
        const tile = getTileAt(col, row);

        if (!tile) {
          console.log(`[SettlementEvaluator] evaluateArea: No tile at (${col}, ${row})`);
          continue;
        }

        const yields = this.getTileYields(tile.type);
        let foodYield = yields.food;
        let shieldsYield = yields.shields;
        let goldYield = yields.gold;

        // Double yields if tile has special resource
        if (tile.resource) {
          foodYield *= 2;
          shieldsYield *= 2;
          goldYield *= 2;
          console.log(`[SettlementEvaluator] evaluateArea: Resource bonus at (${col}, ${row}): ${tile.resource}`);
        }

        totalFood += foodYield;
        totalShields += shieldsYield;
        totalGold += goldYield;

        console.log(`[SettlementEvaluator] evaluateArea: Tile (${col}, ${row}) - ${tile.type}: food=${foodYield}, shields=${shieldsYield}, gold=${goldYield}`);
      }
    }

    // Add bonus for water access
    const waterBonus = this.hasWaterAccess(centerCol, centerRow, getTileAt) ? 2 : 0;
    console.log(`[SettlementEvaluator] evaluateArea: Water bonus: ${waterBonus}`);

    // Calculate weighted score
    const score = (totalFood * weights.food_weight) +
        (totalShields * weights.shields_weight) +
        (totalGold * weights.gold_weight) +
        waterBonus;

    console.log(`[SettlementEvaluator] evaluateArea: Totals - food=${totalFood}, shields=${totalShields}, gold=${totalGold}`);
    console.log(`[SettlementEvaluator] evaluateArea: Final score = (${totalFood}*${weights.food_weight}) + (${totalShields}*${weights.shields_weight}) + (${totalGold}*${weights.gold_weight}) + ${waterBonus} = ${score}`);

    return score;
  }

  /**
   * Evaluate a 3x3 area around a potential settlement location with city proximity penalties
   */
  private static evaluateAreaWithCityPenalties(
    centerCol: number,
    centerRow: number,
    getTileAt: (col: number, row: number) => any,
    getCityAt: (col: number, row: number) => any,
    weights: SettlementWeights,
    currentCivilizationId?: number
  ): number {
    // console.log(`[SettlementEvaluator] evaluateAreaWithCityPenalties: Evaluating with penalties at (${centerCol}, ${centerRow}), civId: ${currentCivilizationId}`);

    let totalFood = 0;
    let totalShields = 0;
    let totalGold = 0;
    let totalCityPenalty = 0;

    // Evaluate 3x3 area around the center
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const col = centerCol + dx;
        const row = centerRow + dy;
        const tile = getTileAt(col, row);

        if (!tile) {
          console.warn(`[SettlementEvaluator] evaluateAreaWithCityPenalties: No tile at (${col}, ${row})`);
          continue;
        }

        const yields = this.getTileYields(tile.type);
        let foodYield = yields.food;
        let shieldsYield = yields.shields;
        let goldYield = yields.gold;

        // Double yields if tile has special resource
        if (tile.resource) {
          foodYield *= 2;
          shieldsYield *= 2;
          goldYield *= 2;
          if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] evaluateAreaWithCityPenalties: Resource bonus at (${col}, ${row}): ${tile.resource}`);
        }

        // Apply city proximity penalties
        let cityPenalty = 0;

        if (currentCivilizationId !== undefined) {
          // Check for cities within 3x3 area of this tile
          for (let cityCheckDy = -1; cityCheckDy <= 1; cityCheckDy++) {
            for (let cityCheckDx = -1; cityCheckDx <= 1; cityCheckDx++) {
              const nearbyCity = getCityAt(col + cityCheckDx, row + cityCheckDy);
              if (nearbyCity) {
                if (nearbyCity.civilizationId === currentCivilizationId) {
                  // Friendly city: -1 penalty per tile in overlap
                  cityPenalty += 1;
                  if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] evaluateAreaWithCityPenalties: Friendly city penalty at (${col + cityCheckDx}, ${row + cityCheckDy})`);
                } else {
                  // Enemy city: -0.2 penalty per tile in overlap
                  cityPenalty += 0.2;
                  if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] evaluateAreaWithCityPenalties: Enemy city penalty at (${col + cityCheckDx}, ${row + cityCheckDy})`);
                }
              }
            }
          }
        }

        totalFood += foodYield;
        totalShields += shieldsYield;
        totalGold += goldYield;
        totalCityPenalty += cityPenalty;

        if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] evaluateAreaWithCityPenalties: Tile (${col}, ${row}) - ${tile.type}: food=${foodYield}, shields=${shieldsYield}, gold=${goldYield}, penalty=${cityPenalty}`);
      }
    }

    // Apply city penalty to the weighted score
    const penaltyFood = totalCityPenalty * weights.food_weight;
    const penaltyShields = totalCityPenalty * weights.shields_weight;
    const penaltyGold = totalCityPenalty * weights.gold_weight;

    totalFood -= penaltyFood;
    totalShields -= penaltyShields;
    totalGold -= penaltyGold;

    // Add bonus for water access
    const waterBonus = this.hasWaterAccess(centerCol, centerRow, getTileAt) ? 2 : 0;
    if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] evaluateAreaWithCityPenalties: Water bonus: ${waterBonus}, Total city penalty: ${totalCityPenalty}`);

    // Calculate weighted score
    const score =
      (totalFood * weights.food_weight) +
      (totalShields * weights.shields_weight) +
      (totalGold * weights.gold_weight) +
      waterBonus;

    if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] evaluateAreaWithCityPenalties: Adjusted totals - food=${totalFood}, shields=${totalShields}, gold=${totalGold}`);
    if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] evaluateAreaWithCityPenalties: Final score: ${score}`);

    return score;
  }

  /**
   * Check if a location is valid for settling
   * @param settlerCol - The settler's current column (to exclude from unit check)
   * @param settlerRow - The settler's current row (to exclude from unit check)
   */
  private static isValidSettlementLocation(
    col: number,
    row: number,
    getTileAt: (col: number, row: number) => any,
    getCityAt: (col: number, row: number) => any,
    getUnitAt: (col: number, row: number) => any,
    settlerCol?: number,
    settlerRow?: number
  ): boolean {
    if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] isValidSettlementLocation: Checking validity at (${col}, ${row})`);

    const tile = getTileAt(col, row);
    
    // Must have a valid tile
    if (!tile) {
      if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] isValidSettlementLocation: No tile at location`);
      return false;
    }

    // Cannot settle on ocean or mountains (typically)
    if (tile.type === Constants.TERRAIN.OCEAN || tile.type === Constants.TERRAIN.MOUNTAINS) {
      if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] isValidSettlementLocation: Invalid terrain: ${tile.type}`);
      return false;
    }

    // Cannot settle where there's already a city
    if (getCityAt(col, row)) {
      if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] isValidSettlementLocation: City already exists at location`);
      return false;
    }

    // Cannot settle where there's another unit (but allow settler's own position)
    const unitAtLocation = getUnitAt(col, row);
    if (unitAtLocation) {
      // If this is the settler's own position, it's valid
      const isSettlerPosition = settlerCol !== undefined && settlerRow !== undefined && 
                                 col === settlerCol && row === settlerRow;
      if (!isSettlerPosition) {
        if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] isValidSettlementLocation: Unit already at location`);
        return false;
      }
    }

    if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] isValidSettlementLocation: Location is valid`);
    return true;
  }

  /**
   * Find the best settlement location within a 10x10 area
   */
  public static findBestSettlementLocation(
    centerCol: number,
    centerRow: number,
    getTileAt: (col: number, row: number) => any,
    getCityAt: (col: number, row: number) => any,
    getUnitAt: (col: number, row: number) => any,
    weights: SettlementWeights,
    minDistanceFromOtherCities: number = 3,
    currentCivilizationId?: number,
    getVisibilityAt?: (col: number, row: number) => boolean,
    canReach?: (fromCol: number, fromRow: number, toCol: number, toRow: number) => boolean
  ): SettlementScore | null {
    console.log(`[SettlementEvaluator] findBestSettlementLocation: Starting search from (${centerCol}, ${centerRow})`);
    console.log(`[SettlementEvaluator] findBestSettlementLocation: Using weights:`, weights);
    console.log(`[SettlementEvaluator] findBestSettlementLocation: Min distance: ${minDistanceFromOtherCities}, Civ ID: ${currentCivilizationId}`);

    let bestLocation: SettlementScore | null = null;
    let bestScore = -Infinity;
    let evaluatedLocations = 0;
    let validLocations = 0;

    // Search in 10x10 area (5 tiles in each direction from center)
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const col = centerCol + dx;
        const row = centerRow + dy;
        evaluatedLocations++;

        // Check if location is valid (pass settler position to allow its own tile)
        if (!this.isValidSettlementLocation(col, row, getTileAt, getCityAt, getUnitAt, centerCol, centerRow)) {
          continue;
        }
        validLocations++;

        // Visibility check intentionally omitted so evaluator can consider all tiles

        // Check reachability - unit must be able to reach the location
        if (canReach && !canReach(centerCol, centerRow, col, row)) {
          console.log(`[SettlementEvaluator] findBestSettlementLocation: Location (${col}, ${row}) not reachable, skipping`);
          continue;
        }

        // Check distance from friendly cities (own civilization)
        // Never settle within 2x2 area of own cities
        let tooCloseToFriendlyCity = false;
        if (currentCivilizationId !== undefined) {
          for (let checkDy = -2; checkDy <= 2; checkDy++) {
            for (let checkDx = -2; checkDx <= 2; checkDx++) {
              if (checkDx === 0 && checkDy === 0) continue;
              const nearbyCity = getCityAt(col + checkDx, row + checkDy);
              if (nearbyCity && nearbyCity.civilizationId === currentCivilizationId) {
                tooCloseToFriendlyCity = true;
                console.log(`[SettlementEvaluator] findBestSettlementLocation: Too close to friendly city at (${col + checkDx}, ${row + checkDy})`);
                break;
              }
            }
            if (tooCloseToFriendlyCity) break;
          }
        } else {
          // Fallback: use old minDistance check if no civilization ID provided
          for (let checkDy = -minDistanceFromOtherCities; checkDy <= minDistanceFromOtherCities; checkDy++) {
            for (let checkDx = -minDistanceFromOtherCities; checkDx <= minDistanceFromOtherCities; checkDx++) {
              if (checkDx === 0 && checkDy === 0) continue;
              if (getCityAt(col + checkDx, row + checkDy)) {
                tooCloseToFriendlyCity = true;
                console.log(`[SettlementEvaluator] findBestSettlementLocation: Too close to city (fallback check)`);
                break;
              }
            }
            if (tooCloseToFriendlyCity) break;
          }
        }

        if (tooCloseToFriendlyCity) continue;

        // Evaluate this location with city proximity penalties
        const score = this.evaluateAreaWithCityPenalties(
          col,
          row,
          getTileAt,
          getCityAt,
          weights,
          currentCivilizationId
        );

        if (this.VERBOSE_LOGGING) console.log(`[SettlementEvaluator] findBestSettlementLocation: Location (${col}, ${row}) score: ${score}`);

        if (score > bestScore) {
          bestScore = score;
          const tile = getTileAt(col, row);
          bestLocation = {
            col,
            row,
            score,
            yields: this.getTileYields(tile.type),
            hasWaterAccess: this.hasWaterAccess(col, row, getTileAt)
          };
          console.log(`[SettlementEvaluator] findBestSettlementLocation: ⭐ New best location found: (${col}, ${row}) with score ${score}`);
        }
      }
    }

    console.log(`[SettlementEvaluator] findBestSettlementLocation: Evaluated ${evaluatedLocations} locations, ${validLocations} were valid`);
    if (bestLocation) {
      console.log(`[SettlementEvaluator] findBestSettlementLocation: ✅ Best location: (${bestLocation.col}, ${bestLocation.row}) with score ${bestLocation.score}`);
    } else {
      console.log(`[SettlementEvaluator] findBestSettlementLocation: ❌ No suitable location found`);
    }

    return bestLocation;
  }

  /**
   * Preset 1: Balanced Growth Strategy
   * Focus on food for early growth, with some production
   */
  public static balancedGrowthWeights(): SettlementWeights {
    return {
      food_weight: 2.0,
      shields_weight: 1.0,
      gold_weight: 0.5
    };
  }

  /**
   * Preset 2: Production Powerhouse Strategy
   * Focus on shields for building units and wonders
   */
  public static productionPowerhouseWeights(): SettlementWeights {
    return {
      food_weight: 1.0,
      shields_weight: 2.5,
      gold_weight: 0.5
    };
  }

  /**
   * Preset 3: Trade and Commerce Strategy
   * Focus on gold/trade for economic dominance
   */
  public static tradeCommerceWeights(): SettlementWeights {
    return {
      food_weight: 1.0,
      shields_weight: 0.5,
      gold_weight: 2.0
    };
  }

  /**
   * Special: Deep Water Coastal City Strategy
   * For building cities specifically for naval access and trade
   * Requires water access and prioritizes coastal benefits
   */
  public static deepWaterCoastalWeights(): SettlementWeights {
    return {
      food_weight: 1.5,  // Fish and coastal resources
      shields_weight: 1.0, // Naval production
      gold_weight: 2.5   // Maritime trade routes
    };
  }

  /**
   * Find best coastal/deepwater settlement location
   * Only considers locations with water access
   */
  public static findBestDeepWaterLocation(
    centerCol: number,
    centerRow: number,
    getTileAt: (col: number, row: number) => any,
    getCityAt: (col: number, row: number) => any,
    getUnitAt: (col: number, row: number) => any,
    minDistanceFromOtherCities: number = 3
  ): SettlementScore | null {
    console.log(`[SettlementEvaluator] findBestDeepWaterLocation: Starting coastal search from (${centerCol}, ${centerRow})`);

    const weights = this.deepWaterCoastalWeights();
    let bestLocation: SettlementScore | null = null;
    let bestScore = -Infinity;
    let evaluatedLocations = 0;
    let validLocations = 0;
    let coastalLocations = 0;

    // Search in 10x10 area
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const col = centerCol + dx;
        const row = centerRow + dy;
        evaluatedLocations++;

        // Must be valid settlement location
        if (!this.isValidSettlementLocation(col, row, getTileAt, getCityAt, getUnitAt)) {
          continue;
        }
        validLocations++;

        // MUST have water access for deep water cities
        if (!this.hasWaterAccess(col, row, getTileAt)) {
          console.log(`[SettlementEvaluator] findBestDeepWaterLocation: Location (${col}, ${row}) has no water access, skipping`);
          continue;
        }
        coastalLocations++;

        // Check distance from other cities
        let tooCloseToCity = false;
        for (let checkDy = -minDistanceFromOtherCities; checkDy <= minDistanceFromOtherCities; checkDy++) {
          for (let checkDx = -minDistanceFromOtherCities; checkDx <= minDistanceFromOtherCities; checkDx++) {
            if (checkDx === 0 && checkDy === 0) continue;
            if (getCityAt(col + checkDx, row + checkDy)) {
              tooCloseToCity = true;
              console.log(`[SettlementEvaluator] findBestDeepWaterLocation: Too close to existing city`);
              break;
            }
          }
          if (tooCloseToCity) break;
        }

        if (tooCloseToCity) continue;

        // Evaluate this coastal location with additional water bonus
        const score = this.evaluateArea(col, row, getTileAt, weights) + 5; // Extra bonus for being coastal

        console.log(`[SettlementEvaluator] findBestDeepWaterLocation: Coastal location (${col}, ${row}) score: ${score} (base + 5 bonus)`);

        if (score > bestScore) {
          bestScore = score;
          const tile = getTileAt(col, row);
          bestLocation = {
            col,
            row,
            score,
            yields: this.getTileYields(tile.type),
            hasWaterAccess: true // Always true for this function
          };
          console.log(`[SettlementEvaluator] findBestDeepWaterLocation: New best coastal location: (${col}, ${row}) with score ${score}`);
        }
      }
    }

    console.log(`[SettlementEvaluator] findBestDeepWaterLocation: Evaluated ${evaluatedLocations} locations, ${validLocations} valid, ${coastalLocations} coastal`);
    if (bestLocation) {
      console.log(`[SettlementEvaluator] findBestDeepWaterLocation: Best coastal location: (${bestLocation.col}, ${bestLocation.row}) with score ${bestLocation.score}`);
    } else {
      console.log(`[SettlementEvaluator] findBestDeepWaterLocation: No suitable coastal location found`);
    }

    return bestLocation;
  }

  /**
   * Get a descriptive name for the settlement strategy
   */
  public static getStrategyName(weights: SettlementWeights): string {
    const balanced = this.balancedGrowthWeights();
    const production = this.productionPowerhouseWeights();
    const trade = this.tradeCommerceWeights();
    const coastal = this.deepWaterCoastalWeights();

    const strategyName = 
      JSON.stringify(weights) === JSON.stringify(balanced) ? "Balanced Growth" :
      JSON.stringify(weights) === JSON.stringify(production) ? "Production Powerhouse" :
      JSON.stringify(weights) === JSON.stringify(trade) ? "Trade & Commerce" :
      JSON.stringify(weights) === JSON.stringify(coastal) ? "Deep Water Coastal" :
      "Custom Strategy";

    console.log(`[SettlementEvaluator] getStrategyName: Identified strategy "${strategyName}" for weights:`, weights);
    return strategyName;
  }
}
