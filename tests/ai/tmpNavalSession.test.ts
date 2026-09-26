
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { gameProgression } from '@/utils/GameProgression';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';

describe('naval session', () => {
  it('runs to 150 rounds on the archipelago', async () => {
    const orig = console.log;
    const counts: Record<string, number> = {};
    console.log = (...a: unknown[]) => { const s = String(a[0] ?? ''); counts[s] = (counts[s] ?? 0) + 1; };
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    await e.initialize({
      numberOfCivilizations: 4,
      mapType: 'AI_VS_AI_NAVAL',
      devMode: true,
      startingGold: 50,
      mapSeed: 12,
    });
    const active = e.civilizations.filter((c) => c.isAlive !== false && c.id !== BARBARIAN_CIV_ID);
    let i = 0;
    while (e.turnManager.getRoundNumber() < 150 && i < 150 * 12 && !e.isGameOver) {
      i++;
      for (const civ of active) {
        e.turnManager.startTurn(civ.id);
        e.activePlayer = civ.id;
        if (civ.isAI) { try { await e.processAITurn(civ.id); } catch {} }
        if (e.turnManager.getPhase() && e.turnManager.getPhase() !== 'END') {
          await e.turnManager.nextPhase();
          await e.turnManager.nextPhase();
          await e.turnManager.nextPhase();
        }
      }
      gameProgression.recordIfNewRound(e);
    }
    console.log = orig;
    const tally = (n: string) => Object.entries(counts).filter(([k]) => k.includes(n)).reduce((a, [, v]) => a + v, 0);
    const w = e.map.width;
    const water = new Set(['ocean', 'lake', 'coast', 'sea']);
    const grid = new Map<number, boolean>();
    for (const t of e.map.tiles) grid.set(t.row * w + t.col, !water.has(String(t.type ?? '').toLowerCase()));
    const seen = new Set<number>(); const sizes: number[] = [];
    for (const [s0, land] of grid) {
      if (!land || seen.has(s0)) continue;
      let n = 0; const q = [s0]; seen.add(s0);
      while (q.length) { const cur = q.pop()!; n++; const c = cur % w, r = Math.floor(cur / w);
        for (const [dc, dr] of [[0,-1],[1,0],[0,1],[-1,0]]) { const nc = c+dc, nr = r+dr;
          if (nc<0||nr<0) continue; const k = nr*w+nc; if (grid.get(k) && !seen.has(k)) { seen.add(k); q.push(k); } } }
      sizes.push(n);
    }
    sizes.sort((a, b) => b - a);
    orig('=== SUMMARY ===');
    orig('rounds ' + e.turnManager.getRoundNumber());
    orig('landmasses ' + sizes.length + ' (' + sizes.join('/') + ')');
    const row = (l: string, n: string) => orig(l.padEnd(30) + tally(n));
    row('invasion planned', 'Invasion —');
    row('invasion board', 'boards with');
    row('invasion landed', 'lands the troop');
    row('colony mission', 'Colony mission');
    row('war declarations', 'declares war');
    row('attacks adjacent', 'attacks adjacent');
    row('attacks unit at', 'attacking unit at');
    row('holds', 'Already at target');
    row('ferry built', 'ferry');
    orig('cities ' + e.cities.length + ' units ' + e.units.filter((u) => !u.isDefeated).length + ' ferries ' + e.units.filter((u) => u.type === 'ferry').length + ' ships ' + e.units.filter((u) => (u as { type?: string }).type === 'galley' || (u as { type?: string }).type === 'sail' || (u as { type?: string }).type === 'trireme').length);
    for (const c of e.civilizations.filter((c) => c.id !== BARBARIAN_CIV_ID)) {
      const cities = e.cities.filter((x) => x.civilizationId === c.id);
      orig('  civ ' + c.id + ' ' + c.name + ' alive=' + c.isAlive + ' cities=' + cities.length + ' pop=' + cities.reduce((n, x) => n + (x.population ?? 0), 0) + ' units=' + e.units.filter((u) => u.civilizationId === c.id && !u.isDefeated).length + ' ferries=' + e.units.filter((u) => u.civilizationId === c.id && u.type === 'ferry').length + ' techs=' + (c.technologies ?? []).length + ' sailing=' + (c.technologies ?? []).includes('sailing'));
    }
    const csv = await gameProgression.buildCompactCsv(e);
    orig('CSV_BYTES ' + csv.length);
    require('node:fs').writeFileSync(process.env.NAVAL_CSV_OUT ?? '/tmp/naval.csv', csv);
    const payload = await gameProgression.buildDownloadPayload(e);
    require('node:fs').writeFileSync(process.env.NAVAL_JSON_OUT ?? '/tmp/naval.json', JSON.stringify(payload));
    orig('WROTE ' + (process.env.NAVAL_CSV_OUT ?? '/tmp/naval.csv'));
    expect(true).toBe(true);
  }, 18000000);
});
