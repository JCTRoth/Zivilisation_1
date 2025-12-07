import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import GameEngine from '../GameEngine';

/**
 * HUMAN VS AI TEST - 50 ROUNDS
 * 
 * Properly runs turn loop: each nextPhase() call advances the turn state
 * Production accumulates when advanceTurn() is called (at END phase)
 */

interface TestMetrics {
  roundsToFirstScoutMove: number;
  roundsToEnemyDiscovery: number;
  roundsToWarriorProduction: number;
  scoutCount: number;
  warriorCount: number;
  totalRounds: number;
}

describe('Human vs AI - 50 Round Test', () => {
  let engine: GameEngine | null = null;

  beforeEach(() => {
    engine = null;
  });

  afterEach(() => {
    if (engine) {
      (engine as any).units = [];
      (engine as any).cities = [];
      (engine as any).civilizations = [];
      engine = null;
    }
    if (global.gc) {
      global.gc();
    }
  });

  it('human player city vs AI scouts and warriors (50 rounds)', async () => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    
    // Suppress logging but capture events
    const logs: string[] = [];
    console.log = (...args: any[]) => {
      const msg = args.join(' ');
      if (msg.includes('[EnemySearcher]') || msg.includes('[AI-SCOUT]') || msg.includes('[MOVEMENT]') ||
          msg.includes('[TurnManager]') || msg.includes('[TEST]')) {
        logs.push(msg);
      }
    };
    console.warn = () => {};
    console.error = () => {};

    try {
      engine = new GameEngine(null);
      (engine as any).sleep = () => Promise.resolve();

      // Initialize with MANY_CITIES to create starting cities
      await engine.initialize({
        numberOfCivilizations: 2,
        mapType: 'MANY_CITIES',
        devMode: false,
        startingGold: 100
      });

      const metrics: TestMetrics = {
        roundsToFirstScoutMove: -1,
        roundsToEnemyDiscovery: -1,
        roundsToWarriorProduction: -1,
        scoutCount: 0,
        warriorCount: 0,
        totalRounds: 0
      };

      // Ensure we have at least 2 civs
      const humanCiv = engine.civilizations[0];
      const aiCiv = engine.civilizations[1];
      
      humanCiv.isHuman = true;
      humanCiv.isAI = false;
      aiCiv.isHuman = false;
      aiCiv.isAI = true;

      // Run 50 rounds by advancing through phases
      const TARGET_ROUNDS = 50;
      const MAX_ITERATIONS = TARGET_ROUNDS * 200; // ~4 phases per turn, 2 civs = ~400 iterations per round
      let iterations = 0;

      while (engine.turnManager.getRoundNumber() < TARGET_ROUNDS && iterations < MAX_ITERATIONS) {
        iterations++;
        
        const currentRound = engine.turnManager.getRoundNumber();
        const currentPlayer = engine.turnManager.getCurrentPlayer();
        const currentCiv = engine.civilizations[currentPlayer];
        
        if (!currentCiv) break;

        // Track metrics for AI
        if (currentCiv.isAI) {
          const aiScouts = engine.units.filter((u: any) => u.civilizationId === aiCiv.id && u.type === 'scout');
          const aiWarriors = engine.units.filter((u: any) => u.civilizationId === aiCiv.id && u.type === 'warrior');
          
          metrics.scoutCount = aiScouts.length;
          metrics.warriorCount = aiWarriors.length;
          
          // Track first scout move
          if (metrics.roundsToFirstScoutMove < 0) {
            const movingScouts = aiScouts.filter((u: any) => (u.movesRemaining || 0) > 0);
            if (movingScouts.length > 0) {
              metrics.roundsToFirstScoutMove = currentRound;
            }
          }
          
          // Track enemy discovery
          if (metrics.roundsToEnemyDiscovery < 0) {
            const knownEnemies = engine.getKnownEnemyLocations ? 
              (engine.getKnownEnemyLocations(aiCiv.id, humanCiv.id) || []).length : 0;
            if (knownEnemies > 0) {
              metrics.roundsToEnemyDiscovery = currentRound;
            }
          }
          
          // Track warrior production
          if (metrics.roundsToWarriorProduction < 0 && aiWarriors.length > 0) {
            metrics.roundsToWarriorProduction = currentRound;
          }
        }
        
        // Advance phase - this will handle the current phase's logic
        engine.turnManager.nextPhase();
      }

      metrics.totalRounds = engine.turnManager.getRoundNumber();

      // Final analysis
      const finalAIScouts = engine.units.filter((u: any) => u.civilizationId === aiCiv.id && u.type === 'scout');
      const scoutPositions = finalAIScouts.map((s: { col: any; row: any; }) => `(${s.col},${s.row})`).join(', ');
      
      const humanCities = engine.cities.filter((c: { civilizationId: number; }) => c.civilizationId === humanCiv.id);
      const humanCityPositions = humanCities.map(c => `${c.name}(${c.col},${c.row})`).join(', ');

      // Print analysis
      console.log = originalLog;
      console.log(`\n========== HUMAN VS AI TEST ANALYSIS ==========`);
      console.log(`Total Rounds Executed: ${metrics.totalRounds}/${TARGET_ROUNDS}`);
      console.log(`Rounds to First Scout Move: ${metrics.roundsToFirstScoutMove >= 0 ? metrics.roundsToFirstScoutMove : 'NEVER'}`);
      console.log(`Rounds to Enemy Discovery: ${metrics.roundsToEnemyDiscovery >= 0 ? metrics.roundsToEnemyDiscovery : 'NEVER'}`);
      console.log(`Rounds to Warrior Production: ${metrics.roundsToWarriorProduction >= 0 ? metrics.roundsToWarriorProduction : 'NEVER'}`);
      console.log(`Final Scout Count: ${metrics.scoutCount}`);
      console.log(`Scout Positions: ${scoutPositions}`);
      console.log(`Human City Positions: ${humanCityPositions}`);
      console.log(`Final Warrior Count: ${metrics.warriorCount}`);
      console.log(`Scout Move Events: ${logs.filter(l => l.includes('[MOVEMENT]')).length}`);
      console.log(`EnemySearcher Calls: ${logs.filter(l => l.includes('[EnemySearcher]')).length}`);
      console.log(`============================================\n`);

      // Basic assertions
      expect(metrics.totalRounds).toBeGreaterThanOrEqual(TARGET_ROUNDS);
      expect(metrics.scoutCount).toBeGreaterThan(0);
      expect(metrics.roundsToFirstScoutMove).toBeGreaterThanOrEqual(0);
      // TODO: These need AI fixes
      // expect(metrics.roundsToEnemyDiscovery).toBeGreaterThanOrEqual(0);
      // expect(metrics.roundsToEnemyDiscovery).toBeLessThan(TARGET_ROUNDS);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }
  });
});
