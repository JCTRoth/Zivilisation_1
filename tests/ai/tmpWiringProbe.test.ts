/**
 * Ad-hoc wiring probe (NOT a test — vitest.config.js excludes `tmp*`).
 *   npx vitest run --config vitest.diag.config.ts tests/ai/tmpWiringProbe.test.ts
 *
 * Calls the AI's own buildGameState on a LIVE engine and asks what it would
 * research, so we can see whether the caravan signal survives the wiring.
 */
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import GameEngine from '@/game/engine/GameEngine';
import { AIResearch } from '@/game/engine/AI/AIResearch';
import { describe, it, expect } from 'vitest';
import { useSeededRandom } from '../helpers/world';

const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 100);
const SEEDS = (process.env.PROBE_SEEDS ?? '7').split(',').map(Number);

describe('wiring probe', () => {
  it('asks the live AI what it would research', async () => {
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
      const samples: string[] = [];

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
        const round = engine.turnManager.getRoundNumber();
        if (round % 25 === 0) {
          for (const civ of active) {
            const cities = engine.cities.filter((c) => c.civilizationId === civ.id);
            const state = (engine.aiManager as unknown as {
              buildGameState: (id: number) => Record<string, unknown>;
            }).buildGameState(civ.id);
            const techs = (civ.technologies ?? []) as string[];
            const available = (AIResearch as unknown as {
              getAvailableTechnologies: (c: unknown) => string[];
            }).getAvailableTechnologies(civ);
            const top = available
              .map((id) => ({ id, score: AIResearch.scoreTechnology(id, civ.personality ?? {}, civ.productionProfile ?? 'balanced_growth', state as never).score }))
              .sort((a, b) => b.score - a.score)
              .slice(0, 4);
            samples.push(
              `r${round} ${String(civ.name).padEnd(11)} cities=${cities.length} rel=${String(state.caravanRelevance)} cur=${civ.currentResearch?.id ?? '-'} top=${top.map((t) => `${t.id}:${t.score.toFixed(0)}`).join(' ')}`,
            );
          }
        }
      }
      console.log = log; console.warn = warn; console.error = err;
      out(`\n### WIRING seed=${seed} rounds=${engine.turnManager.getRoundNumber()}`);
      for (const s of samples) out('  ' + s);
      out(`  final techs: ${active.map((c) => `${c.name}=${((c.technologies ?? []) as string[]).includes('trade') ? 'TRADE' : 'no-trade'}`).join(' ')}`);
      expect(true).toBe(true);
    }
  }, 1800000);
});
