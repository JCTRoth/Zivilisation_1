import { describe, expect, it, beforeEach } from 'vitest';
import { ScoutMemory } from '@shared/game/engine/ScoutMemory';
import { EnemyLocation } from '@shared/game/engine/EnemySearcher';

describe('ScoutMemory', () => {
  let scoutMemory: ScoutMemory;

  beforeEach(() => {
    scoutMemory = new ScoutMemory();
    scoutMemory.setCurrentRound(1);
  });

  describe('recordDiscovery', () => {
    it('should record a new discovery', () => {
      const location: EnemyLocation = {
        col: 10,
        row: 10,
        type: 'unit',
        id: 'unit1',
        discoveredRound: 1,
        lastSeenRound: 1
      };

      scoutMemory.recordDiscovery(2, location);
      const discoveries = scoutMemory.getDiscoveries(2);

      expect(discoveries.length).toBe(1);
      expect(discoveries[0].col).toBe(10);
      expect(discoveries[0].row).toBe(10);
    });

    it('should update existing discovery instead of duplicating', () => {
      const location: EnemyLocation = {
        col: 10,
        row: 10,
        type: 'unit',
        id: 'unit1',
        discoveredRound: 1,
        lastSeenRound: 1
      };

      scoutMemory.recordDiscovery(2, location);
      scoutMemory.setCurrentRound(5);
      scoutMemory.recordDiscovery(2, location);

      const discoveries = scoutMemory.getDiscoveries(2);
      expect(discoveries.length).toBe(1);
      expect(discoveries[0].lastSeenRound).toBe(5);
    });

    it('should increment confirmation count on update', () => {
      const location: EnemyLocation = {
        col: 10,
        row: 10,
        type: 'city',
        id: 'city1',
        discoveredRound: 1,
        lastSeenRound: 1
      };

      scoutMemory.recordDiscovery(2, location);
      scoutMemory.recordDiscovery(2, location);
      scoutMemory.recordDiscovery(2, location);

      const discoveries = scoutMemory.getDiscoveries(2);
      expect(discoveries[0].confirmationCount).toBe(3);
    });

    it('should track discoveries for multiple enemy civilizations', () => {
      const location1: EnemyLocation = {
        col: 10, row: 10, type: 'unit', id: 'unit1',
        discoveredRound: 1, lastSeenRound: 1
      };
      const location2: EnemyLocation = {
        col: 20, row: 20, type: 'city', id: 'city1',
        discoveredRound: 1, lastSeenRound: 1
      };

      scoutMemory.recordDiscovery(2, location1);
      scoutMemory.recordDiscovery(3, location2);

      expect(scoutMemory.getDiscoveries(2).length).toBe(1);
      expect(scoutMemory.getDiscoveries(3).length).toBe(1);
    });
  });

  describe('getDiscoveries', () => {
    it('should return empty array for unknown civilization', () => {
      expect(scoutMemory.getDiscoveries(99)).toEqual([]);
    });

    it('should return all discoveries for a civilization', () => {
      const locations: EnemyLocation[] = [
        { col: 10, row: 10, type: 'unit', id: 'unit1', discoveredRound: 1, lastSeenRound: 1 },
        { col: 15, row: 15, type: 'city', id: 'city1', discoveredRound: 1, lastSeenRound: 1 },
        { col: 20, row: 20, type: 'unit', id: 'unit2', discoveredRound: 1, lastSeenRound: 1 }
      ];

      for (const loc of locations) {
        scoutMemory.recordDiscovery(2, loc);
      }

      expect(scoutMemory.getDiscoveries(2).length).toBe(3);
    });
  });

  describe('getNearestUnexploredTarget', () => {
    it('should return null when no discoveries exist', () => {
      expect(scoutMemory.getNearestUnexploredTarget(5, 5, 2)).toBeNull();
    });

    it('should return null when all discoveries are recent', () => {
      const location: EnemyLocation = {
        col: 10, row: 10, type: 'unit', id: 'unit1',
        discoveredRound: 1, lastSeenRound: 1
      };
      scoutMemory.recordDiscovery(2, location);
      scoutMemory.setCurrentRound(5); // Only 4 rounds passed

      expect(scoutMemory.getNearestUnexploredTarget(5, 5, 2, 10)).toBeNull();
    });

    it('should return stale discovery when age exceeds maxAge', () => {
      const location: EnemyLocation = {
        col: 10, row: 10, type: 'unit', id: 'unit1',
        discoveredRound: 1, lastSeenRound: 1
      };
      scoutMemory.recordDiscovery(2, location);
      scoutMemory.setCurrentRound(15); // 14 rounds passed

      const result = scoutMemory.getNearestUnexploredTarget(5, 5, 2, 10);
      expect(result).not.toBeNull();
      expect(result?.col).toBe(10);
    });

    it('should return nearest stale target', () => {
      const locations: EnemyLocation[] = [
        { col: 100, row: 100, type: 'unit', id: 'unit1', discoveredRound: 1, lastSeenRound: 1 },
        { col: 10, row: 10, type: 'unit', id: 'unit2', discoveredRound: 1, lastSeenRound: 1 },
      ];
      for (const loc of locations) {
        scoutMemory.recordDiscovery(2, loc);
      }
      scoutMemory.setCurrentRound(15);

      const result = scoutMemory.getNearestUnexploredTarget(5, 5, 2, 10);
      expect(result?.id).toBe('unit2'); // (10,10) is closer to (5,5)
    });
  });

  describe('getNearestStaleTarget', () => {
    it('should return null when no discoveries exist', () => {
      expect(scoutMemory.getNearestStaleTarget(5, 5, 2)).toBeNull();
    });

    it('should return null when all discoveries are recent', () => {
      const location: EnemyLocation = {
        col: 10, row: 10, type: 'unit', id: 'unit1',
        discoveredRound: 1, lastSeenRound: 1
      };
      scoutMemory.recordDiscovery(2, location);
      scoutMemory.setCurrentRound(5); // Only 4 rounds passed (< maxAge 10)

      expect(scoutMemory.getNearestStaleTarget(5, 5, 2, 10)).toBeNull();
    });

    it('should find stale targets across ALL enemy civilizations', () => {
      // Far discovery for civ 2, nearer stale discovery for civ 3.
      scoutMemory.recordDiscovery(2, { col: 100, row: 100, type: 'city', id: 'c1', discoveredRound: 1, lastSeenRound: 1 });
      scoutMemory.recordDiscovery(3, { col: 8, row: 8, type: 'unit', id: 'u1', discoveredRound: 1, lastSeenRound: 1 });
      scoutMemory.setCurrentRound(15); // Both are stale (age 14)

      const result = scoutMemory.getNearestStaleTarget(5, 5, 2, 10);
      expect(result).not.toBeNull();
      // (8,8) is nearer to (5,5) than (100,100), even though it belongs to civ 3.
      expect(result?.col).toBe(8);
      expect(result?.row).toBe(8);
    });

    it('should respect maxAge', () => {
      // Record at round 1 (recordDiscovery stamps lastSeenRound = current round).
      scoutMemory.recordDiscovery(2, { col: 8, row: 8, type: 'unit', id: 'u1', discoveredRound: 1, lastSeenRound: 1 });
      scoutMemory.setCurrentRound(5); // age 4 < 10
      expect(scoutMemory.getNearestStaleTarget(5, 5, 2, 10)).toBeNull();

      scoutMemory.setCurrentRound(15); // age 14 >= 10
      expect(scoutMemory.getNearestStaleTarget(5, 5, 2, 10)).not.toBeNull();
    });
  });

  describe('removeDiscovery', () => {
    it('should remove an existing discovery', () => {
      const location: EnemyLocation = {
        col: 10, row: 10, type: 'unit', id: 'unit1',
        discoveredRound: 1, lastSeenRound: 1
      };
      scoutMemory.recordDiscovery(2, location);

      const removed = scoutMemory.removeDiscovery(2, 10, 10, 'unit');
      expect(removed).toBe(true);
      expect(scoutMemory.getDiscoveries(2).length).toBe(0);
    });

    it('should return false when discovery does not exist', () => {
      const removed = scoutMemory.removeDiscovery(2, 10, 10, 'unit');
      expect(removed).toBe(false);
    });

    it('should only remove matching discovery', () => {
      const locations: EnemyLocation[] = [
        { col: 10, row: 10, type: 'unit', id: 'unit1', discoveredRound: 1, lastSeenRound: 1 },
        { col: 10, row: 10, type: 'city', id: 'city1', discoveredRound: 1, lastSeenRound: 1 },
      ];
      for (const loc of locations) {
        scoutMemory.recordDiscovery(2, loc);
      }

      scoutMemory.removeDiscovery(2, 10, 10, 'unit');
      const remaining = scoutMemory.getDiscoveries(2);
      
      expect(remaining.length).toBe(1);
      expect(remaining[0].type).toBe('city');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const locations: EnemyLocation[] = [
        { col: 10, row: 10, type: 'unit', id: 'unit1', discoveredRound: 1, lastSeenRound: 1 },
        { col: 15, row: 15, type: 'city', id: 'city1', discoveredRound: 1, lastSeenRound: 1 },
        { col: 20, row: 20, type: 'unit', id: 'unit2', discoveredRound: 1, lastSeenRound: 1 },
        { col: 25, row: 25, type: 'city', id: 'city2', discoveredRound: 1, lastSeenRound: 1 },
      ];
      
      scoutMemory.recordDiscovery(2, locations[0]);
      scoutMemory.recordDiscovery(2, locations[1]);
      scoutMemory.recordDiscovery(3, locations[2]);
      scoutMemory.recordDiscovery(3, locations[3]);

      const stats = scoutMemory.getStats();
      
      expect(stats.totalDiscoveries).toBe(4);
      expect(stats.byType['unit']).toBe(2);
      expect(stats.byType['city']).toBe(2);
    });

    it('should return zero counts for empty memory', () => {
      const stats = scoutMemory.getStats();
      expect(stats.totalDiscoveries).toBe(0);
      expect(stats.byType).toEqual({});
    });
  });

  describe('clear', () => {
    it('should clear all discoveries', () => {
      const location: EnemyLocation = {
        col: 10, row: 10, type: 'unit', id: 'unit1',
        discoveredRound: 1, lastSeenRound: 1
      };
      scoutMemory.recordDiscovery(2, location);
      scoutMemory.recordDiscovery(3, location);

      scoutMemory.clear();

      expect(scoutMemory.getDiscoveries(2)).toEqual([]);
      expect(scoutMemory.getDiscoveries(3)).toEqual([]);
      expect(scoutMemory.getStats().totalDiscoveries).toBe(0);
    });
  });
});
