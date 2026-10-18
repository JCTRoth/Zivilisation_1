import { describe, expect, it, afterEach } from 'vitest';
import { useSeededRandom } from './helpers/world';
import GameEngine from '@/game/engine/GameEngine';

/**
 * Human autoproduction over a real game: the auto-managed human capital must
 * explore (at least one scout) without drowning the empire in settlers (at
 * most three auto-built), and must never dissolve its own cities.
 *
 * Drives the same phase loop as the Human-vs-AI test: nextPhase() advances
 * turns for every civ, human unit orders untouched (settlers pile up instead
 * of founding, which is exactly what the cap is measured against).
 */
describe('Human autoproduction mix over 30 rounds', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as any).units = [];
      (engine as any).cities = [];
      (engine as any).civilizations = [];
      engine = null;
    }
    if (global.gc) global.gc();
  });

  it('builds a scout early and caps auto settlers', async () => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    try {
      useSeededRandom(7);
      engine = new GameEngine(null);
      (engine as any).sleep = () => Promise.resolve();
      await engine.initialize({
        numberOfCivilizations: 2,
        mapType: 'MANY_CITIES',
        devMode: false,
        startingGold: 100,
        mapSeed: 20260103,
      });

      const humanCiv = (engine as GameEngine).civilizations[0];
      humanCiv.isHuman = true;
      humanCiv.isAI = false;
      const e = engine as GameEngine;

      const humanCities = () => e.cities.filter((c: any) => c.civilizationId === humanCiv.id);
      const startingCities = humanCities().length;
      expect(startingCities).toBeGreaterThan(0);
      for (const city of humanCities()) city.autoProduction = true;

      // Count what the human autoproduction actually builds.
      const produced: Record<string, number> = {};
      const prevOSC = e.onStateChange as ((...args: never[]) => unknown) | null;
      e.onStateChange = ((...args: never[]) => {
        const [type, data] = args as unknown as [string, { unit?: { civilizationId?: number; type?: string } }];
        if (type === 'UNIT_PRODUCED' && data?.unit?.civilizationId === humanCiv.id) {
          const k = data?.unit?.type ?? '?';
          produced[k] = (produced[k] ?? 0) + 1;
        }
        return typeof prevOSC === 'function' ? prevOSC(...args) : undefined;
      }) as typeof e.onStateChange;

      const TARGET_ROUNDS = 30;
      const MAX_ITERATIONS = TARGET_ROUNDS * 200;
      let iterations = 0;
      while (
        e.turnManager.getRoundNumber() < TARGET_ROUNDS
        && iterations < MAX_ITERATIONS
        && !e.isGameOver
      ) {
        iterations++;
        const currentCiv = e.civilizations[e.turnManager.getCurrentPlayer()];
        if (!currentCiv) break;
        e.turnManager.nextPhase();
      }

      const humanSettlers = e.units.filter(
        (u: any) => u.civilizationId === humanCiv.id && u.type === 'settler' && !u.isDefeated,
      ).length;
      const humanScouts = e.units.filter(
        (u: any) => u.civilizationId === humanCiv.id && u.type === 'scout' && !u.isDefeated,
      ).length;

      // The scout corps exists (exploration happened)…
      expect(humanScouts + (produced.scout ?? 0)).toBeGreaterThan(0);
      // …without a settler flood (pipeline cap, not a churn).
      expect(produced.settler ?? 0).toBeLessThanOrEqual(3);
      expect(humanSettlers).toBeLessThanOrEqual(4);
      // …and no city dissolved itself for a settler.
      expect(humanCities().length).toBeGreaterThanOrEqual(startingCities);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }
  }, 300000);
});
