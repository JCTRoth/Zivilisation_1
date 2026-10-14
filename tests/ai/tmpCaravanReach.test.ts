/**
 * DIAGNOSTIC — probe only, never part of `npm test` (vitest.diag.config).
 *
 * Caravans get built now (3/game) but no route ever appears. The engine's
 * delivery rule is "a caravan standing on a city tile delivers", so this hands
 * caravans to every AI civ on a real AI_VS_AI map and reports what the governor
 * does with them for 60 rounds: which target it picks, how far it gets, and
 * whether the step advances at all.
 */
import { describe, it, expect } from 'vitest';
import { useSeededRandom } from '../helpers/world';
import GameEngine from '@/game/engine/GameEngine';

const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 60);
const SEED = Number(process.env.PROBE_SEED ?? 7);

describe('caravan reach on a real map', () => {
  it('hands a caravan to every AI civ and watches it', async () => {
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

    // Fast-forward to a world with cities.
    let i = 0;
    while (e.turnManager.getRoundNumber() < 80 && i < 800 && !e.isGameOver) {
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

    const aiCities = e.cities.filter((c) => active.some((a) => a.id === c.civilizationId));
    (console as unknown as { log: (...a: unknown[]) => void }).log = orig;
    orig(`\n=== seed ${SEED}: round ${e.turnManager.getRoundNumber()}, ${aiCities.length} AI cities ===`);
    for (const c of aiCities) {
      orig(`  city ${c.name} civ${c.civilizationId} at (${c.col},${c.row}) pop=${c.population} routes=${(c.tradeRoutes as unknown[] ?? []).length}`);
    }
    orig(`  total cities on the map: ${e.cities.length}`);

    // Hand every AI city a caravan, then watch the governor for ROUNDS more.
    let n = 0;
    for (const c of aiCities) {
      e.units.push({
        id: `probe-caravan-${n++}`, type: 'caravan', civilizationId: c.civilizationId,
        homeCityId: c.id, col: c.col, row: c.row, isDefeated: false, movesRemaining: 1,
      } as never);
    }

    const gov = (e as any).aiManager.caravanGovernor;
    const hist = new Map<string, { plans: string[]; from: string; to: string; target: string }>();
    while (e.turnManager.getRoundNumber() < 80 + ROUNDS && i < 1600 && !e.isGameOver) {
      i++;
      for (const civ of active) {
        e.turnManager.startTurn(civ.id);
        e.activePlayer = civ.id;
        // Observe the governor directly (a read-only replay of its decision).
        for (const u of e.units) {
          if (u.type !== 'caravan' || u.civilizationId !== civ.id || u.isDefeated) continue;
          if (!u.id.startsWith('probe-caravan-')) continue;
          const h = hist.get(u.id) ?? { plans: [], from: `${u.col},${u.row}`, to: `${u.col},${u.row}`, target: '-' };
          h.to = `${u.col},${u.row}`;
          hist.set(u.id, h);
        }
        if (civ.isAI) { try { await e.processAITurn(civ.id); } catch { /* probe */ } }
        if (e.turnManager.getPhase() && e.turnManager.getPhase() !== 'END') {
          await e.turnManager.nextPhase(); await e.turnManager.nextPhase(); await e.turnManager.nextPhase();
        }
      }
      // After the civs have acted, read the governor's mission for each probe caravan.
      for (const u of e.units) {
        if (u.type !== 'caravan' || !u.id.startsWith('probe-caravan-')) continue;
        const m = gov.getMission(u.id);
        const h = hist.get(u.id);
        if (!h) continue;
        if (m) { h.target = `${m.targetCol},${m.targetRow}`; h.plans.push(`${m.phase}/t${m.transitTurns}`); }
        else h.plans.push('nomission');
      }
    }

    (console as unknown as { log: (...a: unknown[]) => void }).log = orig;
    const routes = e.cities.reduce((nn, c) => nn + ((c.tradeRoutes as unknown[] ?? []).length, 0), 0) as number;
    orig(`routes at round ${e.turnManager.getRoundNumber()}: ${routes}`);
    for (const [id, h] of hist) {
      const summary = h.plans.reduce<Record<string, number>>((acc, p) => { acc[p] = (acc[p] ?? 0) + 1; return acc; }, {});
      const text = Object.entries(summary).map(([k, v]) => `${k}:${v}`).join(' ');
      orig(`  ${id} ${h.from} → ${h.to} target=${h.target} | ${text}`);
    }
    orig(`  probe caravans alive: ${e.units.filter((u) => u.type === 'caravan' && u.id.startsWith('probe-')).length} / ${n}`);
    orig('=== end ===\n');
    expect(true).toBe(true);
  });
});
