import { describe, it, expect, beforeEach } from 'vitest';
import GameEngine from '@shared/game/engine/GameEngine';

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

describe('Newly founded cities default to Auto Production', () => {
  let engine: GameEngine;

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100
    });
  });

  it('enables autoProduction by default when a human founds a city with a settler', () => {
    const width = (engine as any).map?.width ?? 80;
    const height = (engine as any).map?.height ?? 50;

    // Find a valid non-ocean tile far enough from existing cities.
    let pos: { col: number; row: number } | null = null;
    for (let row = 0; row < height && !pos; row++) {
      for (let col = 0; col < width && !pos; col++) {
        const tile = (engine as any).getTileAt?.(col, row);
        if (!tile || tile.type === 'OCEAN' || tile.type === 'ocean') continue;
        const tooClose = engine.cities.some((c: any) =>
          Math.abs(c.col - col) + Math.abs(c.row - row) < 3
        );
        if (!tooClose) pos = { col, row };
      }
    }
    expect(pos).not.toBeNull();

    const settler = {
      id: 'settler_autoprod_test',
      civilizationId: 0,
      type: 'settler',
      col: pos!.col,
      row: pos!.row,
      movesRemaining: 1,
      attack: 0,
      defense: 1,
      maxMoves: 1,
    };
    (engine as any).units.push(settler);

    const beforeCount = engine.cities.length;
    engine.foundCityWithSettler(settler.id);

    const city = engine.cities.find(
      (c: any) => c.civilizationId === 0 && engine.cities.indexOf(c) >= beforeCount
    );
    expect(city).toBeTruthy();
    expect((city as any).autoProduction).toBe(true);
  });

  it('keeps autoProduction enabled by default for AI cities', () => {
    // In MANY_CITIES mode, AI civ 1 gets starting cities via
    // createStartingCities; those must keep auto-production on so the AI
    // actually builds units/buildings each turn.
    const aiCities = engine.cities.filter((c: any) => c.civilizationId === 1);
    expect(aiCities.length).toBeGreaterThan(0);
    for (const city of aiCities) {
      expect((city as any).autoProduction).toBe(true);
    }
  });
});
