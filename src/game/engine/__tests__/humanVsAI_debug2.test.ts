import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '../GameEngine';

describe('Human vs AI Debug v2', () => {
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

  it('trace production accumulation over 10 rounds', async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();

    // Initialize
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100
    });

    console.log('=== INITIAL STATE ===');
    const aiCity = engine.cities.filter(c => c.civilizationId === 1)[0];
    console.log(`AI City: ${aiCity.name}`);
    console.log(`  Yields: ${JSON.stringify(aiCity.yields)}`);
    console.log(`  CurrentProduction: ${aiCity.currentProduction?.itemType} (cost ${aiCity.currentProduction?.cost})`);
    console.log(`  productionStored: ${aiCity.productionStored}`);

    // Manually run the turn progression
    console.log(`\n=== TURN PROGRESSION ===`);
    
    let maxTurns = 0;
    const maxIterations = 100;
    let iter = 0;
    
    while (maxTurns < 10 && iter < maxIterations) {
      iter++;
      
      // Get the active civilization
      const activeCiv = engine.civilizations[engine.turnManager.getCurrentPlayer()];
      if (!activeCiv) break;
      
      const phase = engine.turnManager.getPhase();
      console.log(`\nIter ${iter}: Player ${activeCiv.id} (${activeCiv.name}), Phase: ${phase}`);
      
      // Show city production status
      const civCities = engine.cities.filter(c => c.civilizationId === activeCiv.id);
      for (const city of civCities) {
        if (city.civilizationId === 1 && city === aiCity) {
          console.log(`  AI City production: ${city.productionStored}/${city.currentProduction?.cost}`);
        }
      }
      
      // Advance phase
      engine.turnManager.nextPhase();
      
      // Check if round changed
      const roundBefore = maxTurns;
      const newRound = engine.turnManager.getRoundNumber();
      if (newRound > roundBefore) {
        maxTurns = newRound;
        console.log(`\n>>> ROUND ADVANCED TO ${maxTurns}`);
      }
    }

    console.log(`\n=== FINAL STATE ===`);
    console.log(`AI City production after 10 rounds: ${aiCity.productionStored}/${aiCity.currentProduction?.cost}`);
    
    // Check units
    const scouts = engine.units.filter(u => u.type === 'scout' && u.civilizationId === 1);
    console.log(`AI Scouts: ${scouts.length}`);
    
    expect(scouts.length).toBeGreaterThan(0);
  });
});
