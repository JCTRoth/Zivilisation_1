import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

describe('Human vs AI Debug', () => {
  let engine: GameEngine | null = null;

  beforeEach(() => {
    // Reset engine
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

  it('debug: check city creation with MANY_CITIES', async () => {
    engine = new GameEngine(null);
    
    // Remove sleeps
    (engine as any).sleep = () => Promise.resolve();

    // Initialize with 2 civilizations
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100
    });

    console.log('=== INITIALIZATION COMPLETE ===');
    console.log(`Cities count: ${engine.cities.length}`);
    console.log(`Units count: ${engine.units.length}`);
    console.log(`Civilizations count: ${engine.civilizations.length}`);

    // Check cities
    for (let i = 0; i < engine.cities.length; i++) {
      const city = engine.cities[i];
      console.log(`\nCity ${i}: ${city.name} (civ ${city.civilizationId})`);
      console.log(`  Position: (${city.col}, ${city.row})`);
      console.log(`  Yields: ${JSON.stringify(city.yields)}`);
      console.log(`  CurrentProduction: ${JSON.stringify(city.currentProduction)}`);
      console.log(`  AutoProduction: ${(city as any).autoProduction}`);
      console.log(`  BuildQueue: ${city.buildQueue?.length || 0} items`);
    }

    // Check units
    console.log(`\n=== UNITS ===`);
    for (let i = 0; i < engine.units.length; i++) {
      const unit = engine.units[i];
      console.log(`Unit ${i}: ${unit.type} (civ ${unit.civilizationId}) at (${unit.col}, ${unit.row})`);
    }

    // Run 5 turns and see if scouts are produced
    console.log(`\n=== RUNNING 5 TURNS ===`);
    for (let round = 0; round < 5; round++) {
      console.log(`\n--- ROUND ${round} ---`);
      
      const activeCivs = engine.civilizations.filter((c: any) => c.isAlive !== false);
      for (const civ of activeCivs) {
        engine.turnManager.startTurn(civ.id);
        
        // Get cities before
        const civCitiesBefore = engine.cities.filter((c: any) => c.civilizationId === civ.id);
        console.log(`${civ.name} turn: ${civCitiesBefore.length} cities`);
        
        for (const city of civCitiesBefore) {
          console.log(`  City ${city.name}:`);
          console.log(`    productionStored: ${city.productionStored}/${city.currentProduction?.cost || 0}`);
          console.log(`    currentProduction: ${city.currentProduction?.itemType}`);
        }

        // Process turn
        const phase = engine.turnManager.getPhase();
        if (phase && phase !== 'END') {
          engine.turnManager.nextPhase();
          engine.turnManager.nextPhase();
          engine.turnManager.nextPhase();
        }
      }
    }

    // Check final units
    console.log(`\n=== UNITS AFTER 5 ROUNDS ===`);
    console.log(`Total units: ${engine.units.length}`);
    for (const unit of engine.units) {
      console.log(`  ${unit.type} (civ ${unit.civilizationId}) at (${unit.col}, ${unit.row})`);
    }

    // Verify scout exists
    const scouts = engine.units.filter((u: any) => u.type === 'scout');
    expect(scouts.length).toBeGreaterThan(0);
  });
});
