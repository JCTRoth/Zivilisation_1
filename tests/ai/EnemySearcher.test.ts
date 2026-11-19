import { describe, expect, it, beforeEach } from 'vitest';
import { EnemySearcher } from '@shared/game/engine/EnemySearcher';

describe('EnemySearcher', () => {
  const mapWidth = 20;
  const mapHeight = 20;

  // Mock data stores
  let mockUnits: Map<string, any>;
  let mockCities: Map<string, any>;
  let visibleTiles: Set<string>;

  const getUnitAt = (col: number, row: number): any => mockUnits.get(`${col},${row}`);
  const getCityAt = (col: number, row: number): any => mockCities.get(`${col},${row}`);
  const isVisible = (col: number, row: number): boolean => visibleTiles.has(`${col},${row}`);

  beforeEach(() => {
    mockUnits = new Map();
    mockCities = new Map();
    visibleTiles = new Set();

    // Make central area visible by default
    for (let col = 0; col < mapWidth; col++) {
      for (let row = 0; row < mapHeight; row++) {
        visibleTiles.add(`${col},${row}`);
      }
    }
  });

  describe('findNearestEnemy', () => {
    it('should find nearest enemy unit when no cities present', () => {
      mockUnits.set('10,10', { id: 'unit1', civilizationId: 2 });
      mockUnits.set('15,15', { id: 'unit2', civilizationId: 2 });

      const result = EnemySearcher.findNearestEnemy(
        5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1
      );

      expect(result).not.toBeNull();
      expect(result?.targetType).toBe('unit');
      expect(result?.targetId).toBe('unit1'); // (10,10) is closer to (5,5)
    });

    it('should prioritize cities over units', () => {
      mockUnits.set('6,6', { id: 'unit1', civilizationId: 2 }); // Very close unit
      mockCities.set('10,10', { id: 'city1', civilizationId: 2 }); // Farther city

      const result = EnemySearcher.findNearestEnemy(
        5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1
      );

      expect(result).not.toBeNull();
      // Cities are prioritized over units even if farther away
      expect(result?.targetType).toBe('city');
    });

    it('should return null when no enemies exist', () => {
      const result = EnemySearcher.findNearestEnemy(
        5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1
      );

      expect(result).toBeNull();
    });

    it('should ignore own units and cities', () => {
      mockUnits.set('6,6', { id: 'unit1', civilizationId: 1 }); // Own unit
      mockCities.set('7,7', { id: 'city1', civilizationId: 1 }); // Own city

      const result = EnemySearcher.findNearestEnemy(
        5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1
      );

      expect(result).toBeNull();
    });

    it('should respect visibility', () => {
      visibleTiles.clear();
      visibleTiles.add('5,5'); // Only starting position visible
      
      mockUnits.set('10,10', { id: 'unit1', civilizationId: 2 });

      const result = EnemySearcher.findNearestEnemy(
        5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1
      );

      expect(result).toBeNull(); // Enemy not in visible area
    });

    it('should calculate correct distance', () => {
      mockUnits.set('8,5', { id: 'unit1', civilizationId: 2 });

      const result = EnemySearcher.findNearestEnemy(
        5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1
      );

      expect(result?.distance).toBe(3); // Chebyshev distance from (5,5) to (8,5)
    });

    it('should respect maxRadius parameter', () => {
      mockUnits.set('15,15', { id: 'unit1', civilizationId: 2 }); // Far away

      const result = EnemySearcher.findNearestEnemy(
        5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1, 5 // Max radius 5
      );

      expect(result).toBeNull(); // Unit is too far
    });

    it('should return result with priority field', () => {
      mockCities.set('8,8', { id: 'city1', civilizationId: 2 });

      const result = EnemySearcher.findNearestEnemy(
        5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1
      );

      expect(result?.priority).toBeDefined();
      expect(typeof result?.priority).toBe('number');
    });
  });

  describe('findAllEnemiesInRadius', () => {
    it('should find all enemies within radius', () => {
      mockUnits.set('6,5', { id: 'unit1', civilizationId: 2 });
      mockUnits.set('7,5', { id: 'unit2', civilizationId: 2 });
      mockCities.set('8,5', { id: 'city1', civilizationId: 2 });

      const results = EnemySearcher.findAllEnemiesInRadius(
        5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1, 10
      );

      expect(results.length).toBe(3);
    });

    it('should return cities before units', () => {
      mockUnits.set('6,5', { id: 'unit1', civilizationId: 2 }); // Closer
      mockCities.set('8,5', { id: 'city1', civilizationId: 2 }); // Farther

      const results = EnemySearcher.findAllEnemiesInRadius(
        5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1, 10
      );

      expect(results[0].targetType).toBe('city'); // Cities first
      expect(results[1].targetType).toBe('unit');
    });

    it('should sort by distance within each category', () => {
      mockUnits.set('10,5', { id: 'unit1', civilizationId: 2 }); // Distance 5
      mockUnits.set('7,5', { id: 'unit2', civilizationId: 2 }); // Distance 2

      const results = EnemySearcher.findAllEnemiesInRadius(
        5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1, 10
      );

      expect(results[0].targetId).toBe('unit2'); // Closer first
      expect(results[1].targetId).toBe('unit1');
    });

    it('should exclude enemies outside radius', () => {
      mockUnits.set('6,5', { id: 'unit1', civilizationId: 2 }); // Inside
      mockUnits.set('18,18', { id: 'unit2', civilizationId: 2 }); // Outside radius 5

      const results = EnemySearcher.findAllEnemiesInRadius(
        5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1, 5
      );

      expect(results.length).toBe(1);
      expect(results[0].targetId).toBe('unit1');
    });

    it('should return empty array when no enemies', () => {
      const results = EnemySearcher.findAllEnemiesInRadius(
        5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1, 10
      );

      expect(results).toEqual([]);
    });
  });

  describe('calculateScoutZones', () => {
    it('should return single zone for 1 scout', () => {
      const zones = EnemySearcher.calculateScoutZones(1, 20, 20);

      expect(zones.length).toBe(1);
      expect(zones[0]).toEqual({ minCol: 0, maxCol: 20, minRow: 0, maxRow: 20 });
    });

    it('should divide map into vertical strips for few scouts', () => {
      const zones = EnemySearcher.calculateScoutZones(2, 20, 20);

      expect(zones.length).toBe(2);
      expect(zones[0].maxCol).toBeLessThanOrEqual(zones[1].minCol);
    });

    it('should return empty array for 0 scouts', () => {
      const zones = EnemySearcher.calculateScoutZones(0, 20, 20);
      expect(zones).toEqual([]);
    });

    it('should create grid zones for many scouts', () => {
      const zones = EnemySearcher.calculateScoutZones(4, 20, 20);

      expect(zones.length).toBe(4);
      // Each zone should have reasonable dimensions
      for (const zone of zones) {
        expect(zone.maxCol - zone.minCol).toBeGreaterThan(0);
        expect(zone.maxRow - zone.minRow).toBeGreaterThan(0);
      }
    });

    it('should cover entire map', () => {
      const zones = EnemySearcher.calculateScoutZones(4, 20, 20);
      
      // Create a coverage map
      const covered = new Set<string>();
      for (const zone of zones) {
        for (let col = zone.minCol; col < zone.maxCol; col++) {
          for (let row = zone.minRow; row < zone.maxRow; row++) {
            covered.add(`${col},${row}`);
          }
        }
      }

      // Should cover most of the map (allowing some overlap or gaps at edges)
      expect(covered.size).toBeGreaterThan(300); // At least 75% coverage
    });
  });

  describe('isInZone', () => {
    const zone = { minCol: 5, maxCol: 15, minRow: 5, maxRow: 15 };

    it('should return true for position inside zone', () => {
      expect(EnemySearcher.isInZone(10, 10, zone)).toBe(true);
    });

    it('should return true for position at zone boundary (inclusive start)', () => {
      expect(EnemySearcher.isInZone(5, 5, zone)).toBe(true);
    });

    it('should return false for position at zone boundary (exclusive end)', () => {
      expect(EnemySearcher.isInZone(15, 15, zone)).toBe(false);
    });

    it('should return false for position outside zone', () => {
      expect(EnemySearcher.isInZone(0, 0, zone)).toBe(false);
      expect(EnemySearcher.isInZone(20, 20, zone)).toBe(false);
    });
  });

  describe('hasVisibleEnemyCities', () => {
    it('should return true when enemy city is visible', () => {
      mockCities.set('10,10', { id: 'city1', civilizationId: 2 });

      const result = EnemySearcher.hasVisibleEnemyCities(
        mapWidth, mapHeight, getCityAt, isVisible, 1
      );

      expect(result).toBe(true);
    });

    it('should return false when no enemy cities exist', () => {
      const result = EnemySearcher.hasVisibleEnemyCities(
        mapWidth, mapHeight, getCityAt, isVisible, 1
      );

      expect(result).toBe(false);
    });

    it('should return false when only own cities exist', () => {
      mockCities.set('10,10', { id: 'city1', civilizationId: 1 });

      const result = EnemySearcher.hasVisibleEnemyCities(
        mapWidth, mapHeight, getCityAt, isVisible, 1
      );

      expect(result).toBe(false);
    });

    it('should return false when enemy city is not visible', () => {
      visibleTiles.clear();
      mockCities.set('10,10', { id: 'city1', civilizationId: 2 });

      const result = EnemySearcher.hasVisibleEnemyCities(
        mapWidth, mapHeight, getCityAt, isVisible, 1
      );

      expect(result).toBe(false);
    });
  });

  describe('performance', () => {
    it('should handle large maps efficiently', () => {
      const largeMapWidth = 100;
      const largeMapHeight = 100;

      // Make entire map visible
      const largeVisibleTiles = new Set<string>();
      for (let col = 0; col < largeMapWidth; col++) {
        for (let row = 0; row < largeMapHeight; row++) {
          largeVisibleTiles.add(`${col},${row}`);
        }
      }
      const largeIsVisible = (col: number, row: number): boolean => 
        largeVisibleTiles.has(`${col},${row}`);

      // Add some enemies
      mockUnits.set('90,90', { id: 'unit1', civilizationId: 2 });

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        EnemySearcher.findNearestEnemy(
          5, 5, largeMapWidth, largeMapHeight,
          getUnitAt, getCityAt, largeIsVisible, 1
        );
      }
      const end = performance.now();

      // Should complete 100 searches in under 500ms
      expect(end - start).toBeLessThan(500);
    });

    it('should terminate early when close enemy found', () => {
      // Place enemy very close
      mockUnits.set('6,5', { id: 'unit1', civilizationId: 2 });

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        EnemySearcher.findNearestEnemy(
          5, 5, mapWidth, mapHeight, getUnitAt, getCityAt, isVisible, 1
        );
      }
      const end = performance.now();

      // Should be very fast due to early termination
      expect(end - start).toBeLessThan(100);
    });
  });
});
