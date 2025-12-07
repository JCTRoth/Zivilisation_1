import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

describe('City Position Debug', () => {
  it('show where cities and scouts are', async () => {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();

    const originalLog = console.log;

    try {
      await engine.initialize({
        numberOfCivilizations: 2,
        mapType: 'MANY_CITIES',
        devMode: false,
        startingGold: 100
      });

      const humanCiv = engine.civilizations[0];
      const aiCiv = engine.civilizations[1];

      originalLog(`\n=== CIVILIZATION INFO ===`);
      originalLog(`Human: ${humanCiv.name} (id ${humanCiv.id})`);
      originalLog(`AI: ${aiCiv.name} (id ${aiCiv.id})`);

      originalLog(`\n=== HUMAN CITIES ===`);
      const humanCities = engine.cities.filter(c => c.civilizationId === humanCiv.id);
      originalLog(`Total cities in engine: ${engine.cities.length}`);
      originalLog(`Human cities filtered: ${humanCities.length}`);
      humanCities.forEach((city: any, idx: number) => {
        originalLog(`  [${idx}] ${city.name || '?'}: (${city.col}, ${city.row})`);
      });

      originalLog(`\n=== AI CITIES ===`);
      const aiCities = engine.cities.filter((c: any) => c.civilizationId === aiCiv.id);
      for (const city of aiCities) {
        originalLog(`  ${city.name}: (${city.col}, ${city.row})`);
      }

      originalLog(`\n=== MAP ===`);
      originalLog(`Size: ${(engine as any).map.width} x ${(engine as any).map.height}`);

      expect(humanCities.length).toBeGreaterThan(0);
      expect(aiCities.length).toBeGreaterThan(0);
    } finally {
      // nothing
    }
  });
});
