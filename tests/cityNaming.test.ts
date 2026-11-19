import { describe, expect, it } from 'vitest';
import GameEngine from '@shared/game/engine/GameEngine';

/**
 * City naming (Civ1): cities are named ONE AFTER ANOTHER from the civilization's
 * `cityNames` list (e.g. Berlin → Hamburg → Munich), never "<Civ> City N".
 *
 * Regression: `foundCityWithSettler` used a hardcoded `"<civ> City N"` template
 * instead of `getNextCityName`, so every civ got generic names.
 */
describe('City naming — sequential from the civ list', () => {
  const makeEngine = async (): Promise<GameEngine> => {
    const engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'CLOSEUP_1V1',
      devMode: false,
      startingGold: 100,
    });
    return engine;
  };

  it('getNextCityName returns the civ list one after another, then falls back', async () => {
    const engine = await makeEngine();
    const civ = engine.civilizations[0];
    civ.cityNames = ['Alpha', 'Beta', 'Gamma'];
    civ.nextCityNameIndex = 0;

    expect((engine as any).getNextCityName(0)).toBe('Alpha');
    expect((engine as any).getNextCityName(0)).toBe('Beta');
    expect((engine as any).getNextCityName(0)).toBe('Gamma');
    // List exhausted → "<Civ> City N" fallback with an unused number.
    expect((engine as any).getNextCityName(0)).toBe(`${civ.name} City 4`);
  });

  it('skips names already in use and continues sequentially', async () => {
    const engine = await makeEngine();
    const civ = engine.civilizations[0];
    civ.cityNames = ['Alpha', 'Beta', 'Gamma'];
    civ.nextCityNameIndex = 0;
    // A city already named 'Alpha' (e.g. renamed) — the next call must skip it.
    (engine as any).cities.push({ id: 'renamed', name: 'Alpha', civilizationId: 0 });

    expect((engine as any).getNextCityName(0)).toBe('Beta');
    expect((engine as any).getNextCityName(0)).toBe('Gamma');
  });

  it('founds cities with names from the civ list (foundCity path)', async () => {
    const engine = await makeEngine();
    const civ = engine.civilizations[0];
    civ.cityNames = ['Alpha', 'Beta', 'Gamma'];
    civ.nextCityNameIndex = 0;

    const width = (engine as any).map?.width ?? 80;
    const height = (engine as any).map?.height ?? 50;
    const findSpot = (): { col: number; row: number } => {
      for (let row = 1; row < height - 1; row++) {
        for (let col = 1; col < width - 1; col++) {
          const tile = (engine as any).getTileAt?.(col, row);
          if (!tile) continue;
          const type = String(tile.type ?? '').toLowerCase();
          if (type === 'ocean' || type === 'water') continue;
          if (engine.cities.some((c: any) => c.col === col && c.row === row)) continue;
          return { col, row };
        }
      }
      throw new Error('no free spot');
    };

    const s1 = findSpot();
    engine.foundCity(s1.col, s1.row, 0);
    const c1 = engine.cities.find((c: any) => c.col === s1.col && c.row === s1.row);
    expect(c1?.name).toBe('Alpha');

    const s2 = findSpot();
    engine.foundCity(s2.col, s2.row, 0);
    const c2 = engine.cities.find((c: any) => c.col === s2.col && c.row === s2.row);
    expect(c2?.name).toBe('Beta');
  });
});
