/**
 * The amphibious sequence the AI now runs, end to end:
 *
 *   1. the fleet CONCENTRATES on the beach while it is contested,
 *   2. the ferry HOLDS offshore instead of landing into the enemy,
 *   3. once the approaches are clear the force goes ashore,
 *   4. the released hulls follow the advance to the next enemy the troops can
 *      actually walk to.
 *
 * Steps 2 and 4 are the substance. `canUnloadFerry` only refused an enemy
 * standing exactly ON the landing tile, so a force walked onto the sand into a
 * spearman one step away every single time; and once ashore the fleet hunted
 * the nearest enemy HULL anywhere on the ocean, which is not an objective the
 * troops can take.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { AIManager } from '@/game/engine/AI/AIManager';
import type { Unit } from '../../types/game';

const call = <T>(manager: unknown, method: string, ...args: unknown[]): T =>
  (manager as Record<string, (...a: unknown[]) => T>)[method](...args);

describe('clear the beach, then land', () => {
  let engine: GameEngine;
  let manager: AIManager;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    (engine as unknown as { isPaused: boolean }).isPaused = true;
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
      mapSeed: 4242,
    });
    (engine as unknown as { units: unknown[] }).units = [];
    manager = new AIManager(engine);
  });

  afterEach(() => {
    (engine as unknown as { units: unknown[] }).units = [];
  });

  const addUnit = (over: Record<string, unknown>) => {
    const unit = {
      id: `inv_${Math.random()}`,
      civilizationId: 0,
      movesRemaining: 1,
      isDefeated: false,
      health: 100,
      ...over,
    };
    (engine as unknown as { units: unknown[] }).units.push(unit);
    return unit as unknown as Unit & { id: string; col: number; row: number };
  };

  /** Put every tile on one landmass so "reachable from land" is trivially true. */
  const flattenToLand = () => {
    const { map } = engine;
    for (let r = 0; r < map.height; r++) {
      for (let c = 0; c < map.width; c++) {
        const tile = engine.getTileAt(c, r);
        if (tile) {
          tile.terrain = 'grassland';
          tile.type = 'grassland';
        }
      }
    }
  };

  describe('beachIsClear', () => {
    it('is clear when nothing hostile is near', () => {
      expect(call<boolean>(manager, 'beachIsClear', 0, { col: 10, row: 10 })).toBe(true);
    });

    it('is NOT clear with an enemy standing on the beach', () => {
      addUnit({ type: 'warrior', civilizationId: 1, col: 10, row: 10 });
      expect(call<boolean>(manager, 'beachIsClear', 0, { col: 10, row: 10 })).toBe(false);
    });

    it('is NOT clear with an enemy one step off the beach', () => {
      // This is the case `canUnloadFerry` cannot see: the sand is empty, the
      // spearman is beside it, and the landing walks straight into him.
      addUnit({ type: 'warrior', civilizationId: 1, col: 11, row: 11 });
      expect(call<boolean>(manager, 'beachIsClear', 0, { col: 10, row: 10 })).toBe(false);
    });

    it('ignores our own troops on the beach', () => {
      addUnit({ type: 'warrior', civilizationId: 0, col: 10, row: 10 });
      expect(call<boolean>(manager, 'beachIsClear', 0, { col: 10, row: 10 })).toBe(true);
    });

    it('ignores a distant enemy', () => {
      addUnit({ type: 'warrior', civilizationId: 1, col: 30, row: 30 });
      expect(call<boolean>(manager, 'beachIsClear', 0, { col: 10, row: 10 })).toBe(true);
    });
  });

  describe('the ferry holds offshore until it is safe', () => {
    const loadedFerry = () => {
      const ferry = addUnit({
        type: 'ferry', civilizationId: 0, col: 9, row: 10, cargoUnitIds: ['t1'],
      });
      addUnit({ type: 'warrior', civilizationId: 0, col: 10, row: 10, embarkedOn: ferry.id, id: 't1' });
      return ferry;
    };
    const mission = () => ({
      troopIds: ['t1'],
      landedIds: [],
      ferryId: 'loaded',
      targetCityId: 'enemy-city',
      targetLandmassId: 1,
      landTile: { col: 10, row: 10 },
      waterTile: { col: 9, row: 10 },
      rendezvous: { col: 9, row: 10 },
      stage: 'sail' as const,
    });

    it('does not land while the approaches are contested', () => {
      const ferry = loadedFerry();
      addUnit({ type: 'spearman', civilizationId: 1, col: 11, row: 10 });
      const m = mission();
      m.ferryId = ferry.id;

      const acted = call<boolean>(manager, 'tryInvasionFerryAction', ferry, m);
      expect(acted).toBe(false);
      // Nobody went ashore.
      expect(m.landedIds).toEqual([]);
      expect(m.stage).toBe('sail');
    });

    it('lands the force once the beach is clear', () => {
      const ferry = loadedFerry();
      const m = mission();
      m.ferryId = ferry.id;

      const acted = call<boolean>(manager, 'tryInvasionFerryAction', ferry, m);
      expect(acted).toBe(true);
      expect(m.landedIds).toEqual(['t1']);
    });

    it('releases the hull once the force is ashore', () => {
      const ferry = loadedFerry();
      const m = mission();
      m.ferryId = ferry.id;

      call<boolean>(manager, 'tryInvasionFerryAction', ferry, m);
      // The hull is empty and the beach is taken: `siege`, and free again.
      expect(m.stage).toBe('siege');
      expect(m.ferryId).toBeNull();
    });
  });

  describe('the fleet follows the advance to a target the troops can take', () => {
    // These are ENEMY objectives, so the civs have to be at war — at peace the
    // right answer is "there is no objective".
    const atWar = () => {
      (engine as unknown as {
        diplomacyManager: { isAtWar(a: number, b: number): boolean };
      }).diplomacyManager.isAtWar = () => true;
    };

    it('picks the enemy on the same landmass, not the nearest hull at sea', () => {
      flattenToLand();
      atWar();
      // A nearby enemy on land, and a much nearer enemy that is NOT (here:
      // naval, so never a land objective).
      addUnit({ type: 'warrior', civilizationId: 1, col: 17, row: 17 });
      addUnit({ type: 'battleship', civilizationId: 1, col: 11, row: 11 });

      const target = call<{ col: number; row: number } | null>(
        manager, 'nextEnemyFromLand', { col: 10, row: 10 }, 0,
      );
      expect(target).toEqual({ col: 17, row: 17 });
    });

    it('answers null when there is nothing hostile left to walk to', () => {
      flattenToLand();
      atWar();
      expect(call<unknown>(manager, 'nextEnemyFromLand', { col: 10, row: 10 }, 0)).toBeNull();
    });

    it('sees an enemy city as an objective too', () => {
      flattenToLand();
      atWar();
      (engine as unknown as { cities: unknown[] }).cities.push({
        id: 'inv-city', name: 'Target', civilizationId: 1, col: 15, row: 15,
        population: 4, buildings: [], tradeRoutes: [],
      });
      const target = call<{ col: number; row: number } | null>(
        manager, 'nextEnemyFromLand', { col: 10, row: 10 }, 0,
      );
      expect(target).toEqual({ col: 15, row: 15 });
    });
  });

  describe('a hull only hunts what it can sail to', () => {
    it('refuses a target behind a coastline', () => {
      // A ring of land around the aim tile: the hull is on water, the target is
      // on water, and there is no way between them. Chebyshev distance says
      // "close"; the path check says "no".
      const { map } = engine;
      for (let r = 0; r < map.height; r++) {
        for (let c = 0; c < map.width; c++) {
          const tile = engine.getTileAt(c, r);
          if (!tile) continue;
          const inRing = (c >= 12 && c <= 16 && r >= 12 && r <= 16) && !(c === 14 && r === 14);
          tile.terrain = inRing ? 'grassland' : 'ocean';
          tile.type = inRing ? 'grassland' : 'ocean';
        }
      }
      const hull = addUnit({ type: 'destroyer', civilizationId: 0, col: 2, row: 2 });

      expect(call<boolean>(manager, 'navalReachable', hull, { col: 14, row: 14 })).toBe(false);
    });

    it('accepts a target it can actually sail to', () => {
      const { map } = engine;
      for (let r = 0; r < map.height; r++) {
        for (let c = 0; c < map.width; c++) {
          const tile = engine.getTileAt(c, r);
          if (tile) {
            tile.terrain = 'ocean';
            tile.type = 'ocean';
          }
        }
      }
      const hull = addUnit({ type: 'destroyer', civilizationId: 0, col: 2, row: 2 });
      // The CLOSEUP map is 20x20, so the target has to stay in bounds.
      expect(call<boolean>(manager, 'navalReachable', hull, { col: 17, row: 17 })).toBe(true);
    });

    it('is true for the tile the hull is already standing on', () => {
      const hull = addUnit({ type: 'destroyer', civilizationId: 0, col: 5, row: 5 });
      expect(call<boolean>(manager, 'navalReachable', hull, { col: 5, row: 5 })).toBe(true);
    });
  });
});
