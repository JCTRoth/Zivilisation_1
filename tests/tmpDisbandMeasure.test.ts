/** DIAGNOSTIC — probe only. Disband count + wave shape under the budget. */
import { describe, it, expect } from 'vitest';
import { useSeededRandom } from './helpers/world';
import GameEngine from '@/game/engine/GameEngine';

const SEED = Number(process.env.PROBE_SEED ?? 33);
const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 320);

describe('disbands under the standing-army budget', () => {
  it('counts disbands, retirements and waves', async () => {
    const orig = console.log;
    (console as unknown as { log: (...a: unknown[]) => void }).log = () => {};
    useSeededRandom(SEED);
    const e = new GameEngine(null);
    (e as any).sleep = () => Promise.resolve();
    await e.initialize({
      numberOfCivilizations: 4, mapType: 'AI_VS_AI', devMode: false,
      startingGold: 50, mapSeed: SEED,
    });
    const active = e.civilizations.filter((c) => c.isAI !== false);
    let disbands = 0; let retired = 0;
    const waves: string[] = [];
    let waveRound = -1; let waveCount = 0;
    const prev = e.onStateChange;
    e.onStateChange = (type: string, data: any) => {
      if (type === 'UNIT_DISBANDED') {
        disbands++;
        const r = e.turnManager.getRoundNumber();
        if (r === waveRound) waveCount++; else { if (waveCount >= 5) waves.push(`  wave r${waveRound}: ${waveCount} units at once`); waveRound = r; waveCount = 1; }
      }
      if (type === 'ECONOMY_FORGIVEN') retired++;
      return typeof prev === 'function' ? prev(type, data) : undefined;
    };

    let i = 0;
    while (e.turnManager.getRoundNumber() < ROUNDS && i < ROUNDS * 12 && !e.isGameOver) {
      i++;
      for (const civ of active) {
        e.turnManager.startTurn(civ.id);
        e.activePlayer = civ.id;
        if (civ.isAI) { try { await e.processAITurn(civ.id); } catch { /* probe */ } }
        if (e.turnManager.getPhase() && e.turnManager.getPhase() !== 'END') {
          await e.turnManager.nextPhase(); await e.turnManager.nextPhase(); await e.turnManager.nextPhase();
        }
      }
    }
    if (waveCount >= 5) waves.push(`  wave r${waveRound}: ${waveCount} units at once`);

    (console as unknown as { log: (...a: unknown[]) => void }).log = orig;
    orig(`\n=== seed ${SEED}, ${e.turnManager.getRoundNumber()} rounds ===`);
    orig(`idleUnits-style disbands (UNIT_DISBANDED) : ${disbands}`);
    orig(`bankruptcy forgiveness events (ECONOMY_FORGIVEN): ${retired}`);
    orig(`multi-unit waves (>=5 in one round)        : ${waves.length ? '\n' + waves.join('\n') : 'NONE'}`);
    const stock: Record<string, number> = {};
    for (const u of e.units) stock[u.type] = (stock[u.type] ?? 0) + 1;
    orig(`final stock: ${Object.entries(stock).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    orig(`civs alive with cities: ${active.filter((c) => e.cities.some((x) => x.civilizationId === c.id)).length}/${active.length}`);
    orig(`cities: ${e.cities.length}`);
    const routes = e.cities.reduce((n, c) => n + (c.tradeRoutes ?? []).length, 0);
    orig(`trade routes preserved: ${routes}`);
    orig('=== end ===\n');
    expect(true).toBe(true);
  }, 3_600_000);
});
