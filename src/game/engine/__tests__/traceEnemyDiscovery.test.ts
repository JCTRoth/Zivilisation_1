import { describe, it, expect } from 'vitest';
import GameEngine from '../GameEngine';

describe('Trace Enemy Discovery', () => {
  it('check if scouts find enemies', async () => {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();

    // Capture ALL logs for analysis
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      const msg = args.join(' ');
      logs.push(msg);
      if (msg.includes('[AI-SCOUT]') || msg.includes('[EnemySearcher]') || 
          msg.includes('Scout') || msg.includes('enemy') || msg.includes('found')) {
        originalLog(msg);
      }
    };

    try {
      await engine.initialize({
        numberOfCivilizations: 2,
        mapType: 'MANY_CITIES',
        devMode: false,
        startingGold: 100
      });

      const aiCiv = engine.civilizations[1];
      const humanCiv = engine.civilizations[0];
      aiCiv.isAI = true;
      humanCiv.isAI = false;

      console.log(`\n=== STARTING 10-ROUND TRACE ===`);
      console.log(`AI Civ: ${aiCiv.name} (id ${aiCiv.id})`);
      console.log(`Human Civ: ${humanCiv.name} (id ${humanCiv.id})`);
      
      let roundCounter = 0;
      const maxIter = 500;
      let iter = 0;

      while (engine.turnManager.getRoundNumber() < 10 && iter < maxIter) {
        iter++;
        
        const currentRound = engine.turnManager.getRoundNumber();
        if (currentRound > roundCounter) {
          roundCounter = currentRound;
          console.log(`\n>>> ROUND ${currentRound} <<<`);
          
          // Show unit counts
          const aiScouts = engine.units.filter((u: any) => u.civilizationId === aiCiv.id && u.type === 'scout');
          const aiWarriors = engine.units.filter((u: any) => u.civilizationId === aiCiv.id && u.type === 'warrior');
          console.log(`  AI Units: ${aiScouts.length} scouts, ${aiWarriors.length} warriors`);
          
          // Check for known enemies
          const knownEnemies = engine.getKnownEnemyLocations(aiCiv.id, humanCiv.id);
          console.log(`  Known Enemies: ${knownEnemies.length}`);
          if (knownEnemies.length > 0) {
            console.log(`  Enemy locations: ${knownEnemies.map(e => `(${e.col},${e.row})`).join(', ')}`);
          }
        }
        
        engine.turnManager.nextPhase();
      }

      console.log(`\n=== FINAL STATE ===`);
      const knownEnemies = engine.getKnownEnemyLocations(aiCiv.id, humanCiv.id);
      console.log(`Known Enemies: ${knownEnemies.length}`);
      
      // Count scout-related logs
      const scoutLogs = logs.filter(l => l.includes('[AI-SCOUT]'));
      const searcherLogs = logs.filter(l => l.includes('[EnemySearcher]'));
      console.log(`\nSCOUT LOGS: ${scoutLogs.length}`);
      console.log(`SEARCHER LOGS: ${searcherLogs.length}`);
      
      expect(true).toBe(true); // Just run to completion
    } finally {
      console.log = originalLog;
    }
  });
});
