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
  /**
   * Get tile yields based on terrain type
   */
  private static getTileYields(terrainType: string): TileYields {
    const props = TERRAIN_PROPS[terrainType];
    if (!props) {
      return { food: 0, shields: 0, gold: 0 };
    }

    return {
      food: props.food || 0,
      shields: props.production || 0,
      gold: props.trade || 0
    };
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
    // Check if the tile itself is water
    const centerTile = getTileAt(col, row);
    if (centerTile && this.isWaterTile(centerTile.type)) {
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
        return true;
      }
    }

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
    let totalFood = 0;
    let totalShields = 0;
    let totalGold = 0;

    // Evaluate 3x3 area around the center
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const col = centerCol + dx;
        const row = centerRow + dy;
        const tile = getTileAt(col, row);

        if (!tile) continue;

        const yields = this.getTileYields(tile.type);
        let foodYield = yields.food;
        let shieldsYield = yields.shields;
        let goldYield = yields.gold;

        // Double yields if tile has special resource
        if (tile.resource) {
          foodYield *= 2;
          shieldsYield *= 2;
          goldYield *= 2;
        }

        totalFood += foodYield;
        totalShields += shieldsYield;
        totalGold += goldYield;
      }
    }

    // Add bonus for water access
    const waterBonus = this.hasWaterAccess(centerCol, centerRow, getTileAt) ? 2 : 0;

    // Calculate weighted score
    return (totalFood * weights.food_weight) +
        (totalShields * weights.shields_weight) +
        (totalGold * weights.gold_weight) +
        waterBonus;
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
    let totalFood = 0;
    let totalShields = 0;
    let totalGold = 0;

    // Evaluate 3x3 area around the center
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const col = centerCol + dx;
        const row = centerRow + dy;
        const tile = getTileAt(col, row);

        if (!tile) continue;

        const yields = this.getTileYields(tile.type);
        let foodYield = yields.food;
        let shieldsYield = yields.shields;
        let goldYield = yields.gold;

        // Double yields if tile has special resource
        if (tile.resource) {
          foodYield *= 2;
          shieldsYield *= 2;
          goldYield *= 2;
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
                } else {
                  // Enemy city: -0.2 penalty per tile in overlap
                  cityPenalty += 0.2;
                }
              }
            }
          }
        }

        totalFood += foodYield;
        totalShields += shieldsYield;
        totalGold += goldYield;

        // Apply city penalty to the weighted score later (subtract from total)
        totalFood -= cityPenalty * weights.food_weight;
        totalShields -= cityPenalty * weights.shields_weight;
        totalGold -= cityPenalty * weights.gold_weight;
      }
    }

    // Add bonus for water access
    const waterBonus = this.hasWaterAccess(centerCol, centerRow, getTileAt) ? 2 : 0;

    // Calculate weighted score
    const score =
      (totalFood * weights.food_weight) +
      (totalShields * weights.shields_weight) +
      (totalGold * weights.gold_weight) +
      waterBonus;

    return score;
  }

  /**
   * Check if a location is valid for settling
   */
  private static isValidSettlementLocation(
    col: number,
    row: number,
    getTileAt: (col: number, row: number) => any,
    getCityAt: (col: number, row: number) => any,
    getUnitAt: (col: number, row: number) => any
  ): boolean {
    const tile = getTileAt(col, row);
    
    // Must have a valid tile
    if (!tile) return false;

    // Cannot settle on ocean or mountains (typically)
    if (tile.type === Constants.TERRAIN.OCEAN || tile.type === Constants.TERRAIN.MOUNTAINS) {
      return false;
    }

    // Cannot settle where there's already a city
    if (getCityAt(col, row)) return false;

    // Cannot settle where there's another unit
    return !getUnitAt(col, row);

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
    let bestLocation: SettlementScore | null = null;
    let bestScore = -Infinity;

    // Search in 10x10 area (5 tiles in each direction from center)
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const col = centerCol + dx;
        const row = centerRow + dy;

        // Check if location is valid
        if (!this.isValidSettlementLocation(col, row, getTileAt, getCityAt, getUnitAt)) {
          continue;
        }

        // Check visibility - AI can only settle on visible tiles
        if (getVisibilityAt && !getVisibilityAt(col, row)) {
          continue;
        }

        // Check reachability - unit must be able to reach the location
        if (canReach && !canReach(centerCol, centerRow, col, row)) {
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
        }
      }
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
    const weights = this.deepWaterCoastalWeights();
    let bestLocation: SettlementScore | null = null;
    let bestScore = -Infinity;

    // Search in 10x10 area
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const col = centerCol + dx;
        const row = centerRow + dy;

        // Must be valid settlement location
        if (!this.isValidSettlementLocation(col, row, getTileAt, getCityAt, getUnitAt)) {
          continue;
        }

        // MUST have water access for deep water cities
        if (!this.hasWaterAccess(col, row, getTileAt)) {
          continue;
        }

        // Check distance from other cities
        let tooCloseToCity = false;
        for (let checkDy = -minDistanceFromOtherCities; checkDy <= minDistanceFromOtherCities; checkDy++) {
          for (let checkDx = -minDistanceFromOtherCities; checkDx <= minDistanceFromOtherCities; checkDx++) {
            if (checkDx === 0 && checkDy === 0) continue;
            if (getCityAt(col + checkDx, row + checkDy)) {
              tooCloseToCity = true;
              break;
            }
          }
          if (tooCloseToCity) break;
        }

        if (tooCloseToCity) continue;

        // Evaluate this coastal location with additional water bonus
        const score = this.evaluateArea(col, row, getTileAt, weights) + 5; // Extra bonus for being coastal

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
        }
      }
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

    if (JSON.stringify(weights) === JSON.stringify(balanced)) return "Balanced Growth";
    if (JSON.stringify(weights) === JSON.stringify(production)) return "Production Powerhouse";
    if (JSON.stringify(weights) === JSON.stringify(trade)) return "Trade & Commerce";
    if (JSON.stringify(weights) === JSON.stringify(coastal)) return "Deep Water Coastal";
    
    return "Custom Strategy";
  }
}
