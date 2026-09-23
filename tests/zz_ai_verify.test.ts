import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { gameLogger } from '@/utils/GameLogger';

const TARGET_ROUNDS = 200;
const CIVS = 3;

describe('AI-vs-AI verification run', () => {
  it('plays a full game and reports the improvement metrics', async () => {
    const engine: any = new GameEngine(null);
    engine.sleep = () => Promise.resolve();

    const tally: Record<string, number> = {};
    const origLog = gameLogger.log.bind(gameLogger);
    (gameLogger as any).log = (event: string, message: string, detail: Record<string, unknown>) => {
      const key = event || message;
      tally[key] = (tally[key] ?? 0) + 1;
      if (typeof message === 'string' && /move.?fail/i.test(message)) {
        tally.move_failed_msg = (tally.move_failed_msg ?? 0) + 1;
      }
      return origLog(event, message, detail);
    };
    const origState = engine.onStateChange;
    engine.onStateChange = (event: string, data: any) => {
      tally[event] = (tally[event] ?? 0) + 1;
      origState?.(event, data);
    };

    await engine.initialize({
      numberOfCivilizations: CIVS,
      mapType: 'AI_VS_AI',
      devMode: false,
      startingGold: 100,
    });

    const maxScouts: number[] = new Array(CIVS).fill(0);
    let iterations = 0;
    const maxIterations = TARGET_ROUNDS * 400;
    while (engine.turnManager.getRoundNumber() < TARGET_ROUNDS && iterations < maxIterations) {
      iterations++;
      await engine.turnManager.nextPhase();
      const round = engine.turnManager.getRoundNumber();
      if (round % 5 === 0) {
        for (const civ of engine.civilizations) {
          const scouts = engine.units.filter(
            (u: any) => u.civilizationId === civ.id && u.type === 'scout',
          ).length;
          maxScouts[civ.id] = Math.max(maxScouts[civ.id] ?? 0, scouts);
        }
      }
    }

    (gameLogger as any).log = origLog;
    engine.onStateChange = origState;

    const report: any = { rounds: engine.turnManager.getRoundNumber(), civs: [], tally };
    for (const civ of engine.civilizations) {
      const cities = engine.cities.filter((c: any) => c.civilizationId === civ.id);
      const units = engine.units.filter((u: any) => u.civilizationId === civ.id);
      const composition: Record<string, number> = {};
      for (const u of units) composition[u.type] = (composition[u.type] ?? 0) + 1;
      report.civs.push({
        id: civ.id,
        name: civ.name,
        alive: civ.isAlive,
        score: civ.score,
        gold: civ.gold,
        goldPerTurn: civ.goldPerTurn,
        cities: cities.length,
        units: units.length,
        composition,
        maxScouts: maxScouts[civ.id] ?? 0,
        peaceTurns: civ.peaceTurns,
        warWith: [...(civ.warWith ?? [])],
      });
    }
    // eslint-disable-next-line no-console
    console.log('AI-VERIFY-REPORT ' + JSON.stringify(report, null, 2));

    expect(report.rounds).toBeGreaterThanOrEqual(TARGET_ROUNDS);
  }, 600_000);
});
