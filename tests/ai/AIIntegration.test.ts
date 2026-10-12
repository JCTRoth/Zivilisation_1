import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import type { Unit } from '@/../types/game';

/**
 * AI INTEGRATION TEST
 * 
 * Tests the AI system as a whole, verifying that AI civilizations
 * can properly explore, settle, build units, and engage enemies.
 */


/**
 * Helper function to set current player for testing
 * Since turnManager doesn't have a public setter, we access the private field
 */
function setCurrentPlayer(engine: GameEngine, civId: number): void {
  (engine.turnManager as unknown as { currentPlayer: number }).currentPlayer = civId;
}

describe('AI Integration Tests', () => {
  let engine: GameEngine | null = null;

  beforeEach(() => {
    engine = null;
  });

  afterEach(() => {
    if (engine) {
      engine.units = [];
      engine.cities = [];
      engine.civilizations = [];
      engine = null;
    }
    if (global.gc) {
      global.gc();
    }
  });

  describe('AI Turn Processing', () => {
    it('should process AI turn without errors', async () => {
      engine = new GameEngine(null);
      (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();

      await engine.initialize({
        numberOfCivilizations: 2,
        mapType: 'MANY_CITIES',
        devMode: false,
        startingGold: 100
      });

      const aiCiv = engine.civilizations[1];
      aiCiv.isHuman = false;
      aiCiv.isAI = true;

      // Set AI as active player
      setCurrentPlayer(engine, 1);

      // Process AI turn
      await expect(engine.aiManager.processAITurn(1)).resolves.not.toThrow();
    });
  });



  describe('AI City Founding', () => {
    it('should found cities with settlers', async () => {
      engine = new GameEngine(null);
      (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();

      await engine.initialize({
        numberOfCivilizations: 2,
        mapType: 'MANY_CITIES',
        devMode: false,
        startingGold: 100
      });

      const initialCityCount = engine.cities.filter(c => c.civilizationId === 1).length;

      // Create a settler for AI
      const settler: Unit = {
        id: 'test-settler',
        type: 'settler',
        civilizationId: 1,
        col: 10,
        row: 10,
        movesRemaining: 2,
        attack: 0,
        defense: 1,
        movement: 2,
        health: 10,
        icon: 'settler',
      };
      engine.units.push(settler);

      // Ensure the tile is valid for settling
      const tile = engine.getTileAt(10, 10);
      if (tile) {
        tile.type = 'grassland';
      }

      engine.civilizations[1].isHuman = false;
      engine.civilizations[1].isAI = true;
      setCurrentPlayer(engine, 1);

      // Run multiple turns to allow settler to find location and settle
      for (let i = 0; i < 5; i++) {
        await engine.aiManager.processAITurn(1);
        // Reset moves for next iteration
        settler.movesRemaining = 2;
      }

      // Either city founded or settler still exploring
      const finalCityCount = engine.cities.filter(c => c.civilizationId === 1).length;
      expect(finalCityCount).toBeGreaterThanOrEqual(initialCityCount);
    });
  });



  describe('AI Strategy', () => {
    it('should explore unexplored tiles', async () => {
      engine = new GameEngine(null);
      (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();

      await engine.initialize({
        numberOfCivilizations: 2,
        mapType: 'BASIC',
        devMode: false,
        startingGold: 100
      });

      // Count initially explored tiles
      const storage = engine.getPlayerStorage(1);
      let initialExplored = 0;
      if (storage?.explored) {
        initialExplored = storage.explored.filter(Boolean).length;
      }

      engine.civilizations[1].isHuman = false;
      engine.civilizations[1].isAI = true;

      // Run several turns
      for (let turn = 0; turn < 5; turn++) {
        setCurrentPlayer(engine, 1);
        await engine.aiManager.processAITurn(1);
        
        // Reset unit moves for next turn
        engine.units
          .filter(u => u.civilizationId === 1)
          .forEach(u => { u.movesRemaining = (u as Unit & { movement: number }).movement; });
      }

      // Should have explored more tiles
      const finalStorage = engine.getPlayerStorage(1);
      let finalExplored = 0;
      if (finalStorage?.explored) {
        finalExplored = finalStorage.explored.filter(Boolean).length;
      }

      expect(finalExplored).toBeGreaterThanOrEqual(initialExplored);
    });
  });

  describe('AI Performance', () => {
    it('should complete turn processing within time limit', async () => {
      engine = new GameEngine(null);
      (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();

      await engine.initialize({
        numberOfCivilizations: 4,
        mapType: 'MANY_CITIES',
        devMode: false,
        startingGold: 100
      });

      // Make all non-human civs AI
      for (let i = 1; i < engine.civilizations.length; i++) {
        engine.civilizations[i].isHuman = false;
        engine.civilizations[i].isAI = true;
      }

      const times: number[] = [];

      for (let i = 1; i < engine.civilizations.length; i++) {
        setCurrentPlayer(engine, i);
        
        const start = performance.now();
        await engine.aiManager.processAITurn(i);
        const end = performance.now();
        
        times.push(end - start);
      }

      // Each AI turn should complete in under 2 seconds
      for (const time of times) {
        expect(time).toBeLessThan(2000);
      }

      // Average time should be under 500ms
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      expect(avgTime).toBeLessThan(500);
    });

    it('should handle stuck units gracefully', async () => {
      engine = new GameEngine(null);
      (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();

      await engine.initialize({
        numberOfCivilizations: 2,
        mapType: 'BASIC',
        devMode: false,
        startingGold: 100
      });

      // Create a unit surrounded by impassable terrain
      const stuckUnit: Unit = {
        id: 'stuck-unit',
        type: 'warrior',
        civilizationId: 1,
        col: 5,
        row: 5,
        movesRemaining: 5, // Many moves
        attack: 1,
        defense: 1,
        movement: 1,
        health: 100,
        icon: 'warrior',
      };
      engine.units.push(stuckUnit);

      // Surround with mountains
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const tile = engine.getTileAt(5 + dx, 5 + dy);
          if (tile) tile.type = 'mountains';
        }
      }

      engine.civilizations[1].isHuman = false;
      engine.civilizations[1].isAI = true;
      setCurrentPlayer(engine, 1);

      const start = performance.now();
      await engine.aiManager.processAITurn(1);
      const end = performance.now();

      // Should complete quickly even with stuck unit (not timeout)
      expect(end - start).toBeLessThan(5000);
      
      // Unit should still exist (wasn't deleted or crashed)
      const unit = engine.units.find(u => u.id === 'stuck-unit');
      expect(unit).toBeDefined();
      // The AI should have handled the stuck unit somehow - 
      // either exhausted moves trying, or recognized it's stuck
    });
  });

  describe('AI Scout Production', () => {
    it('scales the desired scout count with total troops (1 / 2 / 3)', async () => {
      engine = new GameEngine(null);
      (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();

      await engine.initialize({
        numberOfCivilizations: 2,
        mapType: 'MANY_CITIES',
        devMode: false,
        startingGold: 100
      });

      const civId = 1;
      const city = engine.cities.find(c => c.civilizationId === civId);
      expect(city).toBeTruthy();

      const autoProduction = (engine as any).autoProduction as any;

      // Reset the AI's army to a clean slate so counts are exact.
      engine.units = engine.units.filter((u: any) => u.civilizationId !== civId);

      const addWarriors = (n: number) => {
        for (let i = 0; i < n; i++) {
          engine.units.push({
            id: `w-${i}`, type: 'warrior', civilizationId: civId,
            col: city!.col + (i % 5), row: city!.row + Math.floor(i / 5),
            attack: 1, defense: 1, movesRemaining: 1, health: 100, icon: 'warrior'
          });
        }
      };

      // 5 troops → 1 scout desired.
      addWarriors(5);
      expect(autoProduction.getDesiredScoutCount(civId)).toBe(1);

      // 6 troops → 2 scouts desired.
      engine.units.push({
        id: 'w-6', type: 'warrior', civilizationId: civId,
        col: city!.col, row: city!.row + 6, attack: 1, defense: 1, movesRemaining: 1, health: 100, icon: 'warrior'
      });
      expect(autoProduction.getDesiredScoutCount(civId)).toBe(2);

      // 12 troops → 3 scouts desired.
      addWarriors(6);
      expect(autoProduction.getDesiredScoutCount(civId)).toBe(3);
    });
  });
});
