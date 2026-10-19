/**
 * Probe: naval map behaviour — cities founded, hulls built, caravans built.
 */
import { describe, it, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import { useSeededRandom } from './helpers/world';

describe('probe: naval map', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports the spread on a naval map', async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
    let engine: GameEngine | null = null;
    try {
      (globalThis as unknown as { __civDebugLogs: boolean }).__civDebugLogs = true;
      useSeededRandom(43);
      engine = new GameEngine(null);
      (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
      await engine.initialize({
        numberOfCivilizations: 3,
        mapType: 'AI_VS_AI',
        devMode: true,
        startingGold: 50,
        mapSeed: 424242,
      });

      const maxIterations = 150 * 12;
      let iterations = 0;
      while (
        engine.turnManager.getRoundNumber() < 150
        && iterations < maxIterations
        && !engine.isGameOver
      ) {
        iterations++;
        const activeCivs = engine.civilizations.filter(
          (c) => c.isAlive !== false && c.id !== BARBARIAN_CIV_ID,
        );
        for (const civ of activeCivs) {
          if (engine.turnManager.getRoundNumber() >= 150) break;
          engine.turnManager.startTurn(civ.id);
          engine.activePlayer = civ.id;
          if (civ.isAI) {
            try { await engine.processAITurn(civ.id); } catch { /* invariants */ }
          }
          if (engine.turnManager.getPhase() && engine.turnManager.getPhase() !== 'END') {
            await engine.turnManager.nextPhase();
            await engine.turnManager.nextPhase();
            await engine.turnManager.nextPhase();
          }
        }
      }

      const civs = engine.civilizations.filter((c) => c.id !== BARBARIAN_CIV_ID);
      const report = civs.map((c) => {
        const units = engine!.units.filter((u) => u.civilizationId === c.id && !u.isDefeated);
        return {
          name: c.name,
          cities: engine!.cities.filter((x) => x.civilizationId === c.id).length,
          settlers: units.filter((u) => u.type === 'settler').length,
          caravans: units.filter((u) => u.type === 'caravan').length,
          naval: units.filter((u) => ['sail', 'trireme', 'caravel', 'frigate', 'ironclad', 'destroyer', 'cruiser', 'battleship', 'ferry'].includes(u.type)).length,
          warships: units.filter((u) => ['frigate', 'ironclad', 'destroyer', 'cruiser', 'battleship'].includes(u.type)).length,
          techs: (c.technologies?.length ?? 0),
          hasSailing: Array.isArray(c.technologies) ? c.technologies.includes('sailing') : (c.technologies as Set<string>)?.has('sailing'),
          gold: c.resources?.gold,
        };
      });
      const disbands = logs.filter((l) => l.includes('UNIT_DISBANDED')).length;
      const caravanDisbands = logs.filter((l) => l.includes('Caravan disband')).length;
      process.stdout.write('NAVAL ' + JSON.stringify({ round: engine.turnManager.getRoundNumber(), report, disbands, caravanDisbands }) + '\n');
    } finally {
      console.log = orig;
    }
  }, 600000);
});
