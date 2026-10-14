/**
 * DIAGNOSTIC — probe only, never part of `npm test` (vitest.diag.config).
 *
 * Wraps the governor's `planUnit` so every decision it makes for every caravan is
 * recorded, then reports, per caravan: how many turns it was asked, what it
 * answered, and how far it got. This is the last-mile measurement: production
 * now happens, so the answer to "why is there no trade route" lives in the
 * governor's decisions.
 */
import { describe, it, expect } from 'vitest';
import { useSeededRandom } from '../helpers/world';
import GameEngine from '@/game/engine/GameEngine';

const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 150);
const SEED = Number(process.env.PROBE_SEED ?? 33);

describe('governor decisions for caravans', () => {
  it('records every plan', async () => {
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
    const gov = (e as any).aiManager.caravanGovernor;
    const realPlan = gov.planUnit.bind(gov);
    const records = new Map<string, { born: number; kinds: Record<string, number>; moves: number; first: string; last: string }>();

    gov.planUnit = (unit: any, world: any, round: number) => {
      const before = { col: unit.col, row: unit.row };
      let plan;
      try { plan = realPlan(unit, world, round); } catch (err) {
        const r = records.get(unit.id) ?? { born: round, kinds: {}, moves: 0, first: `${unit.col},${unit.row}`, last: `${unit.col},${unit.row}` };
        r.kinds.THREW = (r.kinds.THREW ?? 0) + 1;
        r.last = `${unit.col},${unit.row}`;
        records.set(unit.id, r);
        throw err;
      }
      const r = records.get(unit.id) ?? { born: round, kinds: {}, moves: 0, first: `${unit.col},${unit.row}`, last: `${unit.col},${unit.row}` };
      const key = plan.kind + (plan.reason ? `:${plan.reason}` : '');
      r.kinds[key] = (r.kinds[key] ?? 0) + 1;
      if (plan.kind === 'move') r.moves += 1;
      if (unit.col !== before.col || unit.row !== before.row) r.last = `${unit.col},${unit.row}`;
      records.set(unit.id, r);
      return plan;
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

    (console as unknown as { log: (...a: unknown[]) => void }).log = orig;
    const routes = e.cities.reduce((n, c) => n + ((c.tradeRoutes as unknown[] ?? []).length), 0);
    orig(`\n=== seed ${SEED}: ${e.turnManager.getRoundNumber()} rounds, routes=${routes} ===`);
    for (const [id, r] of records) {
      const kinds = Object.entries(r.kinds).map(([k, v]) => `${k}:${v}`).join(' ');
      orig(`  ${id} born=r${r.born} ${r.first} → ${r.last} moves=${r.moves} | ${kinds}`);
    }
    orig(`  records=${records.size} caravans alive=${e.units.filter((u: any) => u.type === 'caravan').length}`);
    orig('=== end ===\n');
    expect(true).toBe(true);
  });
});
