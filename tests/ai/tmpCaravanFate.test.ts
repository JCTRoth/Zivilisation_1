/**
 * DIAGNOSTIC — probe only, never part of `npm test` (vitest.diag.config).
 *
 * Caravans are built now (~4.5/game) but zero trade ROUTES appear. This reports
 * every engine/ai log line about caravans, routes, disbands and kills, so the
 * fate of a caravan is recorded rather than guessed.
 */
import { describe, it, expect } from 'vitest';
import { useSeededRandom } from '../helpers/world';
import GameEngine from '@/game/engine/GameEngine';

const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 150);
const SEED = Number(process.env.PROBE_SEED ?? 7);

describe('caravan fate', () => {
  it('records every caravan-related log line and every caravan life', async () => {
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
      if (/aravan|TRADE|trade route|isband|estroyed|killed/i.test(text)) {
        lines.push(`r${e.turnManager.getRoundNumber()} ${text.slice(0, 200)}`);
      }
      return (origLog as (...a: unknown[]) => void).apply(e, args);
    }) as never;

    const seen = new Map<string, { born: number; at: string; col: number; row: number }>();
    const lives: string[] = [];
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
      const round = e.turnManager.getRoundNumber();
      for (const u of e.units) {
        if (u.type === 'caravan' && !seen.has(u.id)) {
          seen.set(u.id, { born: round, at: `${u.col},${u.row}`, col: u.col, row: u.row });
          lives.push(`r${round} BORN  id=${u.id} civ=${u.civilizationId} at ${u.col},${u.row} home=${u.homeCityId}`);
        }
      }
      for (const [id, rec] of [...seen]) {
        const u = e.units.find((x) => x.id === id);
        if (!u) {
          const m = (e as any).aiManager.caravanGovernor.getMission(id);
          lives.push(`r${round} GONE  id=${id} born=r${rec.born}@${rec.at} last=${rec.col},${rec.row} ` +
            `mission=${m ? `${m.phase}->${m.targetCol},${m.targetRow} t=${m.transitTurns} s=${m.stalls} bl=[${m.blacklisted}]` : 'none'}`);
          seen.delete(id);
        } else { rec.col = u.col; rec.row = u.row; }
      }
    }

    (console as unknown as { log: (...a: unknown[]) => void }).log = orig;
    const routes = e.cities.reduce((n, c) => n + ((c.tradeRoutes as unknown[] ?? []).length, 0), 0);
    const tally = lines.reduce<Record<string, number>>((acc, l) => {
      const key = l.replace(/^r\d+ /, '').slice(0, 42).replace(/\d+/g, 'N');
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    orig(`\n=== seed ${SEED}: ${e.turnManager.getRoundNumber()} rounds, routes=${routes} ===`);
    orig(`caravans born: ${lives.filter((l) => l.includes('BORN')).length}, alive: ${e.units.filter((u) => u.type === 'caravan').length}`);
    orig(`--- lives ---`);
    for (const l of lives) orig(l);
    orig(`--- log tally ---`);
    for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 14)) orig(`  ${String(v).padStart(5)}  ${k}`);
    orig(`--- sample lines ---`);
    for (const l of lines.slice(0, 18)) orig(`  ${l}`);
    orig('=== end ===\n');
    expect(true).toBe(true);
  });
});
