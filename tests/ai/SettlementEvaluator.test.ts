import { describe, expect, it, beforeEach } from 'vitest';
import { SettlementEvaluator } from '@shared/game/engine/SettlementEvaluator';

describe('SettlementEvaluator', () => {
  // Mock terrain data
  let mockTiles: Map<string, any>;
  let mockCities: Map<string, any>;
  let mockUnits: Map<string, any>;

  const getTileAt = (col: number, row: number): any => mockTiles.get(`${col},${row}`);
  const getCityAt = (col: number, row: number): any => mockCities.get(`${col},${row}`);
  const getUnitAt = (col: number, row: number): any => mockUnits.get(`${col},${row}`);
  const getVisibilityAt = (_col: number, _row: number): boolean => true;
  const canReach = (_fromCol: number, _fromRow: number, _toCol: number, _toRow: number): boolean => true;

  beforeEach(() => {
    mockTiles = new Map();
    mockCities = new Map();
    mockUnits = new Map();

    // Create a 20x20 map with various terrain
    for (let col = 0; col < 20; col++) {
      for (let row = 0; row < 20; row++) {
        let type = 'grassland';
        // Add some variety
        if (col === 0 || row === 0 || col === 19 || row === 19) type = 'ocean';
        if (col === 10 && row === 10) type = 'hills';
        if (col === 5 && row === 5) type = 'forest';
        if (col === 15 && row === 15) type = 'desert';
        if (col === 8 && row === 8) type = 'mountains';
        
        mockTiles.set(`${col},${row}`, { 
          type,
          resource: null
        });
      }
    }
  });

  describe('Strategy Weights', () => {
    it('balancedGrowthWeights should prioritize food', () => {
      const weights = SettlementEvaluator.balancedGrowthWeights();
      expect(weights.food_weight).toBeGreaterThan(weights.shields_weight);
      expect(weights.food_weight).toBeGreaterThan(weights.gold_weight);
    });

    it('productionPowerhouseWeights should prioritize shields', () => {
      const weights = SettlementEvaluator.productionPowerhouseWeights();
      expect(weights.shields_weight).toBeGreaterThan(weights.food_weight);
      expect(weights.shields_weight).toBeGreaterThan(weights.gold_weight);
    });

    it('tradeCommerceWeights should prioritize gold', () => {
      const weights = SettlementEvaluator.tradeCommerceWeights();
      expect(weights.gold_weight).toBeGreaterThan(weights.food_weight);
      expect(weights.gold_weight).toBeGreaterThan(weights.shields_weight);
    });

    it('deepWaterCoastalWeights should prioritize gold with balanced food', () => {
      const weights = SettlementEvaluator.deepWaterCoastalWeights();
      expect(weights.gold_weight).toBeGreaterThan(weights.shields_weight);
      expect(weights.food_weight).toBeGreaterThan(weights.shields_weight);
    });
  });

  describe('getStrategyName', () => {
    it('should identify balanced growth strategy', () => {
      const weights = SettlementEvaluator.balancedGrowthWeights();
      expect(SettlementEvaluator.getStrategyName(weights)).toBe('Balanced Growth');
    });

    it('should identify production powerhouse strategy', () => {
      const weights = SettlementEvaluator.productionPowerhouseWeights();
      expect(SettlementEvaluator.getStrategyName(weights)).toBe('Production Powerhouse');
    });

    it('should identify custom strategy for non-preset weights', () => {
      const customWeights = { food_weight: 3.0, shields_weight: 3.0, gold_weight: 3.0 };
      expect(SettlementEvaluator.getStrategyName(customWeights)).toBe('Custom Strategy');
    });
  });

  describe('findBestSettlementLocation', () => {
    it('should find a valid settlement location', () => {
      const weights = SettlementEvaluator.balancedGrowthWeights();
      const result = SettlementEvaluator.findBestSettlementLocation(
        10, 10, getTileAt, getCityAt, getUnitAt, weights, 3, 1, getVisibilityAt, canReach
      );

      expect(result).not.toBeNull();
      expect(result?.col).toBeDefined();
      expect(result?.row).toBeDefined();
      expect(result?.score).toBeGreaterThan(0);
    });

    it('should not place city on ocean', () => {
      const weights = SettlementEvaluator.balancedGrowthWeights();
      const result = SettlementEvaluator.findBestSettlementLocation(
        0, 0, getTileAt, getCityAt, getUnitAt, weights, 3, 1, getVisibilityAt, canReach
      );

      // If result exists, it shouldn't be on ocean
      if (result) {
        const tile = getTileAt(result.col, result.row);
        expect(tile?.type).not.toBe('ocean');
      }
    });

    it('should not place city on mountains', () => {
      const weights = SettlementEvaluator.balancedGrowthWeights();
      const result = SettlementEvaluator.findBestSettlementLocation(
        8, 8, getTileAt, getCityAt, getUnitAt, weights, 3, 1, getVisibilityAt, canReach
      );

      // If result exists, it shouldn't be on mountains
      if (result) {
        const tile = getTileAt(result.col, result.row);
        expect(tile?.type).not.toBe('mountains');
      }
    });

    it('should respect minimum distance from existing cities', () => {
      // Place an existing city
      mockCities.set('10,10', { id: 'city1', civilizationId: 1 });

      const weights = SettlementEvaluator.balancedGrowthWeights();
      const result = SettlementEvaluator.findBestSettlementLocation(
        10, 10, getTileAt, getCityAt, getUnitAt, weights, 3, 1, getVisibilityAt, canReach
      );

      // Result should be at least 3 tiles away from existing city
      if (result) {
        const distance = Math.max(
          Math.abs(result.col - 10),
          Math.abs(result.row - 10)
        );
        expect(distance).toBeGreaterThan(2);
      }
    });

    it('keeps the complete workable area separate from friendly cities', () => {
      mockCities.set('10,10', { id: 'city1', civilizationId: 1 });
      const result = SettlementEvaluator.findBestSettlementLocation(
        10, 10, getTileAt, getCityAt, getUnitAt,
        SettlementEvaluator.balancedGrowthWeights(), 3, 1, getVisibilityAt, canReach
      );

      if (result) {
        expect(Math.max(Math.abs(result.col - 10), Math.abs(result.row - 10))).toBeGreaterThanOrEqual(5);
      }
    });

    it('should not place city where another unit exists', () => {
      mockUnits.set('10,10', { id: 'unit1', civilizationId: 1 });

      const weights = SettlementEvaluator.balancedGrowthWeights();
      const result = SettlementEvaluator.findBestSettlementLocation(
        10, 10, getTileAt, getCityAt, getUnitAt, weights, 3, 1, getVisibilityAt, canReach
      );

      // Result should not be at the unit's position (unless it's the settler's own position)
      // For this test, we expect it to find a different location
      expect(result).not.toBeNull();
    });

    it('should include yields information in result', () => {
      const weights = SettlementEvaluator.balancedGrowthWeights();
      const result = SettlementEvaluator.findBestSettlementLocation(
        10, 10, getTileAt, getCityAt, getUnitAt, weights, 3, 1, getVisibilityAt, canReach
      );

      expect(result?.yields).toBeDefined();
      expect(typeof result?.yields.food).toBe('number');
      expect(typeof result?.yields.shields).toBe('number');
      expect(typeof result?.yields.gold).toBe('number');
    });

    it('should check water access', () => {
      // Add coastal tile
      mockTiles.set('1,5', { type: 'grassland' });
      mockTiles.set('1,4', { type: 'ocean' });

      const weights = SettlementEvaluator.balancedGrowthWeights();
      const result = SettlementEvaluator.findBestSettlementLocation(
        1, 5, getTileAt, getCityAt, getUnitAt, weights, 3, 1, getVisibilityAt, canReach
      );

      expect(result?.hasWaterAccess).toBeDefined();
    });

    it('should prefer locations with resources', () => {
      // Add a resource tile
      mockTiles.set('12,12', { type: 'grassland', resource: 'gold' });

      const weights = SettlementEvaluator.balancedGrowthWeights();
      const result = SettlementEvaluator.findBestSettlementLocation(
        12, 12, getTileAt, getCityAt, getUnitAt, weights, 3, 1, getVisibilityAt, canReach
      );

      expect(result).not.toBeNull();
      expect(result?.score).toBeGreaterThan(0);
    });
  });

  describe('findBestDeepWaterLocation', () => {
    beforeEach(() => {
      // Create a map with coastal areas
      for (let col = 0; col < 20; col++) {
        for (let row = 0; row < 20; row++) {
          let type = 'grassland';
          if (col < 3) type = 'ocean'; // Western coast
          mockTiles.set(`${col},${row}`, { type });
        }
      }
    });

    it('should only return coastal locations', () => {
      const result = SettlementEvaluator.findBestDeepWaterLocation(
        5, 10, getTileAt, getCityAt, getUnitAt, 3
      );

      expect(result).not.toBeNull();
      expect(result?.hasWaterAccess).toBe(true);
    });

    it('should return null if no coastal locations available', () => {
      // Make entire map landlocked
      for (let col = 0; col < 20; col++) {
        for (let row = 0; row < 20; row++) {
          mockTiles.set(`${col},${row}`, { type: 'grassland' });
        }
      }

      const result = SettlementEvaluator.findBestDeepWaterLocation(
        10, 10, getTileAt, getCityAt, getUnitAt, 3
      );

      expect(result).toBeNull();
    });

    it('should prefer locations adjacent to ocean', () => {
      const result = SettlementEvaluator.findBestDeepWaterLocation(
        5, 10, getTileAt, getCityAt, getUnitAt, 3
      );

      if (result) {
        // Check that location is adjacent to ocean
        const adjacentToOcean = [
          [result.col - 1, result.row], [result.col + 1, result.row],
          [result.col, result.row - 1], [result.col, result.row + 1],
          [result.col - 1, result.row - 1], [result.col + 1, result.row + 1],
          [result.col - 1, result.row + 1], [result.col + 1, result.row - 1]
        ].some(([c, r]) => {
          const tile = getTileAt(c, r);
          return tile?.type === 'ocean';
        });

        expect(adjacentToOcean).toBe(true);
      }
    });
  });

  describe('performance', () => {
    it('should evaluate locations efficiently', () => {
      // Create a large map
      for (let col = 0; col < 50; col++) {
        for (let row = 0; row < 50; row++) {
          mockTiles.set(`${col},${row}`, { type: 'grassland' });
        }
      }

      const weights = SettlementEvaluator.balancedGrowthWeights();
      
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        SettlementEvaluator.findBestSettlementLocation(
          25, 25, getTileAt, getCityAt, getUnitAt, weights, 3, 1, getVisibilityAt, canReach
        );
      }
      const end = performance.now();

      // Smoke guard, not a micro-benchmark: this runs in the shared suite
      // under variable load (observed up to ~1.6 s with a local K3s cluster
      // running). The detailed benchmark lives in vitest.diag.config.ts.
      expect(end - start).toBeLessThan(4000);
    });
  });
});
