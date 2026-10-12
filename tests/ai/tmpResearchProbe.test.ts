/**
 * Ad-hoc research probe (NOT a test — vitest.config.js excludes `tmp*`).
 *   npx vitest run --config vitest.diag.config.ts tests/ai/tmpResearchProbe.test.ts
 *
 * Why does the AI never build a Caravan? Prints the techs each civ ends with,
 * whether the trade line was reached, and what it chose to research.
 */
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import GameEngine from '@/game/engine/GameEngine';
import { describe, it, expect } from 'vitest';
import { useSeededRandom } from '../helpers/world';

const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 150);
const SEEDS = (process.env.PROBE_SEEDS ?? '7').split(',').map(Number);

describe('research probe', () => {
  it('prints the tech tree each AI reaches', async () => {
    const out = console.info.bind(console);
    for (const seed of SEEDS) {
      useSeededRandom(seed);
      const log = console.log; const warn = console.warn; const err = console.error;
      console.log = () => {}; console.warn = () => {}; console.error = () => {};
      const engine = new GameEngine(null);
      (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
      await engine.initialize({
        numberOfCivilizations: 4, mapType: 'AI_VS_AI', devMode: true,
        startingGold: 50, mapSeed: seed,
      });
      const active = engine.civilizations.filter((c) => c.isAlive !== false && c.id !== BARBARIAN_CIV_ID);
      const researched: Array<{ civ: string; tech: string; round: number }> = [];
      const prevOSC = engine.onStateChange;
      engine.onStateChange = (type: string, data: any, ...rest: unknown[]) => {
        if (type === 'TECH_DISCOVERED' || type === 'RESEARCH_COMPLETED') {
          const tech = data?.tech?.id ?? data?.techId ?? data?.technologyId;
          researched.push({ civ: String(data?.civilizationId), tech: String(tech), round: engine.turnManager.getRoundNumber() });
        }
        return typeof prevOSC === 'function' ? (prevOSC as (...a: unknown[]) => unknown)(type, data, ...rest) : undefined;
      };

      let i = 0;
      while (engine.turnManager.getRoundNumber() < ROUNDS && i < ROUNDS * 12 && !engine.isGameOver) {
        i++;
        for (const civ of active) {
          engine.turnManager.startTurn(civ.id);
          engine.activePlayer = civ.id;
          if (civ.isAI) { try { await engine.processAITurn(civ.id); } catch { /* ignore */ } }
          if (engine.turnManager.getPhase() && engine.turnManager.getPhase() !== 'END') {
            await engine.turnManager.nextPhase();
            await engine.turnManager.nextPhase();
            await engine.turnManager.nextPhase();
          }
        }
      }
      console.log = log; console.warn = warn; console.error = err;
      out(`\n### RESEARCH seed=${seed} rounds=${engine.turnManager.getRoundNumber()}`);
      for (const civ of active) {
        const techs = (civ.technologies ?? []) as string[];
        const cities = engine.cities.filter((c) => c.civilizationId === civ.id).length;
        out(`  ${String(civ.name).padEnd(12)} cities=${cities} techs=${techs.length} trade=${techs.includes('trade')} currency=${techs.includes('currency')}`);
        out(`     ${techs.join(', ')}`);
      }
      out(`  events: ${researched.length} (first 12: ${researched.slice(0, 12).map((r) => `${r.tech}@${r.round}`).join(' ')})`);
      expect(true).toBe(true);
    }
  }, 1800000);
});
