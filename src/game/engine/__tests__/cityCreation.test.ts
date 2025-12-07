import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

describe('City Creation Debug', () => {
  it('trace what cities are created', async () => {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100
    });

    console.log('\n=== CITIES AT START ===');
    for (const city of engine.cities) {
      console.log(`${city.name} (civ ${city.civilizationId}): ${city.currentProduction?.itemType}`);
    }

    console.log('\n=== CIVILIZATIONS ===');
    for (const civ of engine.civilizations) {
      console.log(`Civ ${civ.id}: ${civ.name} (AI: ${civ.isAI})`);
    }

    expect(engine.cities.length).toBeGreaterThan(0);
  });
});
