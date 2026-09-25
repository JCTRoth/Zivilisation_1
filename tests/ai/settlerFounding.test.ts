/**
 * Regression test for the "AI settler never founds a city" issue (20:23 / 20:30
 * AI-vs-AI sessions: 46–50 rounds, 0 cities, settlers idle/wandering).
 *
 * Root cause (fixed): findBestSettlementForSettler chased the 10x10 window
 * maximum forever — the window re-centers on the settler each evaluation, so
 * the "best" tile kept moving ahead. Settlers wandered for 100+ rounds and
 * only founded via the 3-visit oscillation breaker (if at all).
 *
 * Fix: found at the current tile unless the best location is clearly better
 * (SETTLE_SCORE_THRESHOLD) AND close enough (MAX_SETTLE_WALK_DISTANCE). Any
 * walk is bounded and must terminate in a founding.
 *
 * NOTE: AI_VS_AI initialize() auto-starts the turn loop, so we freeze it with
 * isPaused immediately after init to keep the test fast and terminating.
 */
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { useSeededRandom } from '../helpers/world';

const MAX_SETTLE_WALK_DISTANCE = 4;

async function makeAIVsAIEngine(): Promise<GameEngine> {
  const engine = new GameEngine(null);
  (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
  // Pinned world + RNG: the bounded-walk assertion was map-dependent.
  useSeededRandom(7);
  await engine.initialize({
    numberOfCivilizations: 2,
    mapType: 'AI_VS_AI',
    devMode: false,
    startingGold: 100,
    mapSeed: 20260103,
  });
  for (const civ of engine.civilizations) {
    civ.isHuman = false;
    civ.isAI = true;
  }
  // Freeze the autonomous AI-vs-AI turn loop — advanceTurn() defers while paused.
  (engine as unknown as { isPaused: boolean }).isPaused = true;
  return engine;
}

describe('AI settler founds its first city', () => {
  it('each starting settler settles within a bounded walk (no infinite chase)', async () => {
    const engine = await makeAIVsAIEngine();
    const civCount = engine.civilizations.length;
    const probe = (engine.aiManager as unknown as {
      findBestSettlementForSettler: (u: unknown, s?: string) => { col: number; row: number; score: number } | null;
    }).findBestSettlementForSettler.bind(engine.aiManager);

    for (let civId = 0; civId < civCount; civId++) {
      const settler = engine.units.find((u) => u.type === 'settler' && u.civilizationId === civId);
      if (!settler) {
        // Already founded during initialize — good.
        expect(engine.cities.some((c) => c.civilizationId === civId)).toBe(true);
        continue;
      }

      // Simulate the decision loop: evaluate, then "arrive" at the target
      // (teleport, as the path-follow would) and re-evaluate, until it either
      // founds (returns null) or exceeds the bounded walk budget.
      let steps = 0;
      while (engine.units.some((u) => u.id === settler.id)) {
        const result = probe(settler, 'balanced_growth');
        steps++;
        expect(steps, `civ ${civId} settler should settle within ${MAX_SETTLE_WALK_DISTANCE + 2} arrivals`).toBeLessThanOrEqual(MAX_SETTLE_WALK_DISTANCE + 2);
        if (result === null) break; // founded in place

        // Every step must be a bounded walk (the fix forbids far chases).
        const dist = Math.max(Math.abs(result.col - settler.col), Math.abs(result.row - settler.row));
        expect(dist, `civ ${civId} settler walk step should be bounded`).toBeLessThanOrEqual(MAX_SETTLE_WALK_DISTANCE);

        // Simulate arrival at the target.
        settler.col = result.col;
        settler.row = result.row;
      }

      // The settler must have founded a city.
      expect(engine.units.some((u) => u.id === settler.id)).toBe(false);
      expect(engine.cities.some((c) => c.civilizationId === civId)).toBe(true);
    }

    // Every civ ends up with its capital.
    for (let civId = 0; civId < civCount; civId++) {
      expect(engine.cities.some((c) => c.civilizationId === civId && c.isCapital), `civ ${civId} should have a capital`).toBe(true);
    }
  }, 60000);
});
