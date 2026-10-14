/**
 * DIAGNOSTIC — probe only, never part of `npm test` (vitest.diag.config).
 *
 * Follows every Caravan from the moment it is produced to the moment it leaves
 * the field, and prints every engine/ai log line that mentions it or trade.
 * Caravans now GET built (3/game) but zero trade ROUTES appear, so this finds
 * out what happens to them between production and delivery.
 */
import { describe, it, expect } from 'vitest';
import { useSeededRandom } from '../helpers/world';
import GameEngine from '@/game/engine/GameEngine';

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
    const origLog = e.log;
    const lines: string[] = [];
    e.log = ((...args: unknown[]) => {
      const text = args.map(String).join(' ');
      if (/aravan|route|trade/i.test(text)) lines.push(`r${e.turnManager.getRoundNumber()} ${text.slice(0, 190)}`);
      return (origLog as (...a: unknown[]) => void).apply(e, args);
    }) as never;

    const seen = new Map<string, { born: number; bornAt: string; col: number; row: number; lastMove: number }>();
    const gone: string[] = [];
    let i = 0;
    while (e.turnManager.getRoundNumber() < ROUNDS && i < ROUNDS * 12 && !e.isGameOver) {
      i++;
      for (const civ of active) {
        e.turnManager.startTurn(civ.id);
        e.activePlayer = civ.id;
        if (civ.isAI) {
          try { await e.processAITurn(civ.id); } catch { /* the probe reports it */ }
        }
        if (e.turnManager.getPhase() && e.turnManager.getPhase() !== 'END') {
          await e.turnManager.nextPhase();
          await e.turnManager.nextPhase();
          await e.turnManager.nextPhase();
        }
      }
      const round = e.turnManager.getRoundNumber();
      for (const u of e.units) {
        if (u.type === 'caravan' && !seen.has(u.id)) {
          seen.set(u.id, { born: round, bornAt: `${u.col},${u.row}`, col: u.col, row: u.row, lastMove: round });
        }
      }
      for (const [id, rec] of [...seen]) {
        const u = e.units.find((x) => x.id === id);
        if (!u) {
          // Did it die in combat, or was it removed?
          const m = (e as any).aiManager.caravanGovernor.getMission(id);
          gone.push(`r${round} GONE id=${id} born=r${rec.born}@${rec.bornAt} home=${rec.col},${rec.row} ` +
            `mission=${m ? `${m.phase} target=${m.targetCol},${m.targetRow} transit=${m.transitTurns} stalls=${m.stalls}` : 'none'}`);
          seen.delete(id);
        } else if (u.col !== rec.col || u.row !== rec.row) {
          rec.col = u.col; rec.row = u.row; rec.lastMove = round;
        }
      }
    }

    (console as unknown as { log: (...a: unknown[]) => void }).log = orig;
    const routes = e.cities.reduce((n, c) => n + ((c.tradeRoutes as unknown[]) ?? []).length, 0);
    orig(`\n=== seed ${SEED}: ${e.turnManager.getRoundNumber()} rounds ===`);
    orig(`caravans born: ${gone.length + seen.size}   alive at end: ${e.units.filter((u) => u.type === 'caravan').length}   routes: ${routes}`);
    for (const g of gone) orig(g);
    for (const [id, rec] of seen) orig(`r${ROUNDS} ALIVE id=${id} born=r${rec.born}@${rec.bornAt} last=${rec.col},${rec.row}`);
    orig(`--- engine/ai log mentions (first 40) ---`);
    for (const l of lines.slice(0, 40)) orig(l);
    orig(`--- total mention lines: ${lines.length} ---`);
    orig('=== end ===\n');
    expect(true).toBe(true);
  });
});
