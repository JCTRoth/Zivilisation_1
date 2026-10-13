/**
 * DIAGNOSTIC — probe only, never part of `npm test` (vitest.diag.config).
 *
 * Follows every Caravan from the moment it is produced to the moment it leaves
 * the field, and prints the cause. The economy fixes made caravans APPEAR
 * (3.3/game, up from 0) but zero trade ROUTES get established; this finds out
 * where the caravan dies.
 */
import { describe, it, expect, vi } from 'vitest';
import { useSeededRandom } from '../helpers/world';
import GameEngine from '@/game/engine/GameEngine';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';

const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 150);
const SEED = Number(process.env.PROBE_SEED ?? 7);

describe('caravan life cycle', () => {
  it('traces every caravan', async () => {
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

    const seen = new Map<string, { born: number; bornAt: string; col: number; row: number; home: string }>();
    const events: string[] = [];
    let i = 0;
    while (e.turnManager.getRoundNumber() < ROUNDS && i < ROUNDS * 12 && !e.isGameOver) {
      i++;
      for (const civ of active) {
        e.turnManager.startTurn(civ.id);
        e.activePlayer = civ.id;
        if (civ.isAI) {
          try { await e.processAITurn(civ.id); } catch { /* state shows the damage */ }
        }
        if (e.turnManager.getPhase() && e.turnManager.getPhase() !== 'END') {
          await e.turnManager.nextPhase();
          await e.turnManager.nextPhase();
          await e.turnManager.nextPhase();
        }
      }
      const round = e.turnManager.getRoundNumber();
      // Caravan appears
      for (const u of e.units) {
        if (u.type === 'caravan' && !seen.has(u.id)) {
          const home = e.cities.find((c) => c.id === u.homeCityId);
          seen.set(u.id, {
            born: round, bornAt: `${u.col},${u.row}`,
            col: u.col, row: u.row, home: home ? `${home.name}(${home.col},${home.row})` : String(u.homeCityId),
          });
        }
      }
      // Caravan leaves the field (killed or disbanded)
      for (const [id, rec] of [...seen]) {
        const u = e.units.find((x) => x.id === id);
        if (!u) {
          const m = (e as any).aiManager.caravanGovernor.getMission(id);
          const cause = m
            ? `phase=${m.phase} target=${m.targetCol},${m.targetRow} transit=${m.transitTurns} stalls=${m.stalls} blacklisted=[${m.blacklisted}]`
            : 'no mission (forgotten)';
          events.push(`r${round} GONE id=${id} born=r${rec.born} at ${rec.bornAt} home=${rec.home} | ${cause}`);
          seen.delete(id);
        } else {
          rec.col = u.col; rec.row = u.row;
        }
      }
    }

    // Whatever survived.
    for (const [id, rec] of seen) {
      events.push(`r${ROUNDS} ALIVE id=${id} born=r${rec.born} at ${rec.bornAt} home=${rec.home} last=${rec.col},${rec.row}`);
    }

    (console as unknown as { log: (...a: unknown[]) => void }).log = orig;
    const routes = e.cities.reduce((n, c) => n + ((c.tradeRoutes as unknown[]) ?? []).length, 0);
    const alive = e.units.filter((u) => u.type === 'caravan').length;
    orig(`\n=== seed ${SEED}: ${ROUNDS} rounds ===`);
    orig(`caravans born: ${events.filter((x) => x.includes('GONE') || x.includes('ALIVE')).length}`);
    orig(`caravans alive at end: ${alive}   trade routes: ${routes}`);
    for (const ev of events) orig(ev);
    orig('=== end ===\n');
    expect(true).toBe(true);
  });
});
