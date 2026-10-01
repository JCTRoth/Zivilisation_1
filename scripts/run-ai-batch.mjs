#!/usr/bin/env node
/**
 * Batch AI-vs-AI tournament + economy telemetry.
 *
 * Runs N headless Computer-vs-Computer games on the ordinary 40x40 map and
 * reports, per game and in aggregate, who is winning and what the economies
 * are doing. No browser, no dev server: the engine is driven directly, and the
 * map seed makes every game reproducible, so two runs are comparable.
 *
 * Usage:
 *   node scripts/run-ai-batch.mjs [games] [rounds] [civs] [outJson]
 *     games   how many games to play          (default 6)
 *     rounds  how many rounds per game        (default 200)
 *     civs    civilizations per game           (default 4)
 *
 * Example:
 *   node scripts/run-ai-batch.mjs 6 200 4 /tmp/ai-batch.json
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = Number(process.argv[2] ?? 6);
const ROUNDS = Number(process.argv[3] ?? 200);
const CIVS = Number(process.argv[4] ?? 4);
const OUT = process.argv[5] ?? '/tmp/ai-batch.json';
const MAP_TYPE = process.env.AI_BATCH_MAP_TYPE ?? 'AI_VS_AI';
// Distinct seeds so the batch covers different worlds, not one lucky map.
const SEEDS = [7, 19, 33, 51, 64, 88, 101, 129, 142, 177, 190, 210, 233, 246, 259, 271, 288, 301, 314, 327];

const spec = `
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';

const ROUNDS = ${ROUNDS};
const CIVS = ${CIVS};
const MAP_TYPE = ${JSON.stringify(MAP_TYPE)};
const SEEDS = ${JSON.stringify(SEEDS.slice(0, GAMES))};

interface CivSnapshot {
  id: number;
  name: string;
  alive: boolean;
  cities: number;
  pop: number;
  units: number;
  military: number;
  techs: number;
  gold: number;
  tax: number;
  science: number;
  luxury: number;
  ferries: number;
  ships: number;
  profile: string;
}

describe('ai batch', () => {
  it('plays the batch', async () => {
    const orig = console.log;
    const results: unknown[] = [];

    for (const seed of SEEDS) {
      const logCounts: Record<string, number> = {};
      console.log = (...a: unknown[]) => {
        const s = String(a[0] ?? '');
        // Only the interesting AI lines; the engine is far too chatty to keep.
        // 'DIPLOMACY] Civ' catches every war declaration, whichever system
        // declared it. 'declares war' is the AI military-rush line only, so on
        // its own it cannot show what the diplomacy model is doing.
        // The diplomacy outcomes, which are the point of the model: a system
        // that only reports wars cannot tell restraint from paralysis.
        for (const key of [
          'Invasion —', 'declares war', 'DIPLOMACY] Civ',
          'DIPLOMACY] Peace between', 'DIPLOMACY] Ceasefire between', 'DIPLOMACY] Alliance between',
          'DIPLOMACY] Treaty signed', 'DIPLOMACY] Cancelled', 'refused their last',
          'colony', 'ferry', 'disband', 'Revolt', 'anarchy',
        ]) {
          if (s.includes(key)) logCounts[key] = (logCounts[key] ?? 0) + 1;
        }
      };

      const e = new GameEngine(null);
      (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
      await e.initialize({
        numberOfCivilizations: CIVS,
        mapType: MAP_TYPE,
        devMode: true,
        startingGold: 50,
        mapSeed: seed,
      });
      const active = e.civilizations.filter((c) => c.isAlive !== false && c.id !== BARBARIAN_CIV_ID);

      const timeline: Array<{ round: number; civs: CivSnapshot[]; totalGold: number; bankrupt: number }> = [];
      let economy = {
        bankruptCivTurns: 0,
        totalDisbands: 0,
        rateFlips: 0,
        negativeGoldRounds: 0,
        buildings: {} as Record<string, number>,
        unitProductions: 0,
        cityProductions: 0,
        disorderRounds: 0,
        minGold: Infinity,
      };
      const lastRates = new Map<number, string>();

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
        if (round % 5 === 0) {
          const civs: CivSnapshot[] = active.map((c) => {
            const cities = e.cities.filter((x) => x.civilizationId === c.id);
            const units = e.units.filter((u) => u.civilizationId === c.id && !u.isDefeated);
            const gold = c.resources?.gold ?? 0;
            if (gold < 0) economy.bankruptCivTurns++;
            if (gold < economy.minGold) economy.minGold = gold;
            const rateKey = String(c.taxRate) + '/' + String(c.scienceRate) + '/' + String(c.luxuryRate);
            if (lastRates.has(c.id) && lastRates.get(c.id) !== rateKey) economy.rateFlips++;
            lastRates.set(c.id, rateKey);
            for (const city of cities) {
              if (city.currentProduction?.itemType) {
                if (city.currentProduction.type === 'unit') economy.unitProductions++;
                else economy.cityProductions++;
              }
              for (const b of city.buildings ?? []) {
                economy.buildings[b] = (economy.buildings[b] ?? 0) + 1;
              }
              if (city.disorder) economy.disorderRounds++;
            }
            return {
              id: c.id,
              name: c.name,
              alive: c.isAlive !== false,
              cities: cities.length,
              pop: cities.reduce((n, x) => n + (x.population ?? 0), 0),
              units: units.length,
              military: units.reduce((n, u) => n + (u.attack ?? 0) + (u.defense ?? 0) * 0.5, 0),
              techs: (c.technologies ?? []).length,
              gold,
              tax: c.taxRate ?? 0,
              science: c.scienceRate ?? 0,
              luxury: c.luxuryRate ?? 0,
              profile: String(c.productionProfile ?? ''),
              ferries: units.filter((u) => u.type === 'ferry').length,
              ships: units.filter((u) => (u as { type?: string }).type !== undefined && ['sail', 'galley', 'trireme', 'caravel', 'frigate', 'ironclad', 'destroyer', 'cruiser', 'battleship'].includes(u.type as string)).length,
            };
          });
          const totalGold = civs.reduce((n, c) => n + c.gold, 0);
          if (totalGold < 0) economy.negativeGoldRounds++;
          timeline.push({
            round,
            civs,
            totalGold,
            bankrupt: civs.filter((c) => c.gold < 0).length,
          });
        }
      }
      console.log = orig;
      if (economy.minGold === Infinity) economy.minGold = 0;

      const final = active.map((c) => {
        const cities = e.cities.filter((x) => x.civilizationId === c.id);
        const units = e.units.filter((u) => u.civilizationId === c.id && !u.isDefeated);
        return {
          id: c.id,
          name: c.name,
          alive: c.isAlive !== false,
          cities: cities.length,
          pop: cities.reduce((n, x) => n + (x.population ?? 0), 0),
          units: units.length,
          military: units.reduce((n, u) => n + (u.attack ?? 0) + (u.defense ?? 0) * 0.5, 0),
          techs: (c.technologies ?? []).length,
          gold: c.resources?.gold ?? 0,
          profile: String(c.productionProfile ?? ''),
          ferries: units.filter((u) => u.type === 'ferry').length,
          ships: units.filter((u) => ['sail', 'galley', 'trireme', 'caravel', 'frigate', 'ironclad', 'destroyer', 'cruiser', 'battleship'].includes(u.type as string)).length,
        };
      });

      results.push({
        seed,
        rounds: e.turnManager.getRoundNumber(),
        gameOver: e.isGameOver === true,
        civs: final,
        economy,
        logCounts,
        timeline,
      });
    }

    require('node:fs').writeFileSync(${JSON.stringify(OUT)}, JSON.stringify(results));
    orig('BATCH_DONE ' + results.length);
    expect(true).toBe(true);
  }, ${GAMES * 250 * 1000});
});
`;

// The spec must live where vitest's transform and the `@/` alias work, but it
// is a throwaway: write it into tests/ and remove it on the way out, whatever
// happens, so a killed run cannot leave scratch specs behind (four were
// committed once).
const specPath = join(ROOT, 'tests', 'ai', 'tmpAiBatch.test.ts');
writeFileSync(specPath, spec);
const cleanup = () => { try { rmSync(specPath, { force: true }); } catch { /* ignore */ } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

const res = spawnSync(
  'npx',
  ['vitest', 'run', 'tests/ai/tmpAiBatch.test.ts', '--no-file-parallelism'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 128 },
);
cleanup();


if (!existsSync(OUT)) {
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  console.error(out.split('\n').slice(-40).join('\n'));
  console.error(`\nNo batch output at ${OUT} — the run did not finish.`);
  process.exit(res.status ?? 1);
}

const games = JSON.parse(readFileSync(OUT, 'utf8'));

// ── Report ────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 5) => String(typeof v === 'number' ? v.toFixed(1) : v).padStart(n);

console.log(`\n=== ${games.length} × ${MAP_TYPE} · ${ROUNDS} rounds · ${CIVS} civs ===\n`);

console.log('game  seed  rnd  over  winner                 civs  cities  pop  units  mil   techs  gold');
for (const g of games) {
  const winner = [...g.civs].sort((a, b) => b.cities - a.cities || b.pop - a.pop)[0];
  const civsAlive = g.civs.filter((c) => c.alive && c.cities > 0).length;
  console.log(
    `${pad(games.indexOf(g) + 1, 5)}${pad(g.seed, 6)}${pad(g.rounds, 5)}${pad(g.gameOver ? 'yes' : 'no', 6)}` +
    `${pad(winner.name, 22)}${pad(civsAlive, 6)}${pad(winner.cities, 7)}${pad(winner.pop, 5)}${pad(winner.units, 7)}` +
    `${num(winner.military, 5)}${pad(winner.techs, 7)}${num(winner.gold, 7)}`,
  );
}

const sum = (fn) => games.reduce((n, g) => n + fn(g), 0);
const avg = (fn) => (games.length ? sum(fn) / games.length : 0);
const allCivs = games.flatMap((g) => g.civs);

console.log('\n--- aggregate ---');
console.log(`civs still holding cities at the end : ${avg((g) => g.civs.filter((c) => c.alive && c.cities > 0).length).toFixed(2)} / ${CIVS}`);
console.log(`civs wiped out (0 cities)           : ${avg((g) => g.civs.filter((c) => c.alive && c.cities === 0).length).toFixed(2)}`);
console.log(`cities per game                     : ${avg((g) => g.civs.reduce((n, c) => n + c.cities, 0)).toFixed(1)}`);
console.log(`population per game                 : ${avg((g) => g.civs.reduce((n, c) => n + c.pop, 0)).toFixed(1)}`);
console.log(`units per game                      : ${avg((g) => g.civs.reduce((n, c) => n + c.units, 0)).toFixed(1)}`);
console.log(`techs per civ (end)                 : ${avg((g) => g.civs.reduce((n, c) => n + c.techs, 0) / CIVS).toFixed(1)}`);
console.log(`games that reached a decision        : ${games.filter((g) => g.gameOver).length} / ${games.length}`);

console.log('\n--- economy ---');
console.log(`bankrupt civ-turns (gold < 0)        : ${sum((g) => g.economy.bankruptCivTurns)}`);
console.log(`worst single-civ gold               : ${Math.min(...allCivs.map((c) => c.gold)).toFixed(0)}`);
console.log(`civs finishing broke (gold < 0)     : ${allCivs.filter((c) => c.gold < 0).length} / ${allCivs.length}`);
console.log(`rate changes per civ per game       : ${avg((g) => g.economy.rateFlips / CIVS).toFixed(1)}`);
console.log(`disorder snapshots                  : ${sum((g) => g.economy.disorderRounds)}`);
const buildings = {};
for (const g of games) for (const [k, v] of Object.entries(g.economy.buildings)) buildings[k] = (buildings[k] ?? 0) + v;
console.log(`buildings per game                  : ${Object.entries(buildings).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / games.length).toFixed(1)}`).join('  ')}`);

console.log('\n--- by personality (winning games) ---');
const wins = {};
for (const g of games) {
  const winner = [...g.civs].sort((a, b) => b.cities - a.cities || b.pop - a.pop)[0];
  const key = winner.profile || 'unknown';
  wins[key] = (wins[key] ?? 0) + 1;
}
for (const [k, v] of Object.entries(wins).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v} wins`);
const dead = {};
for (const g of games) for (const c of g.civs) {
  if (c.cities === 0) dead[c.profile || 'unknown'] = (dead[c.profile || 'unknown'] ?? 0) + 1;
}
console.log('  wiped civs by personality: ' + (Object.entries(dead).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('  ') || 'none'));

console.log('\n--- war ---');
console.log(`declarations per game               : ${avg((g) => g.logCounts['declares war'] ?? 0).toFixed(1)}`);
console.log(`all war declarations per game       : ${avg((g) => g.logCounts['DIPLOMACY] Civ'] ?? 0).toFixed(1)}`);
console.log(`AI military rushes per game         : ${avg((g) => g.logCounts['declares war'] ?? 0).toFixed(1)}`);
console.log(`invasions per game                  : ${avg((g) => g.logCounts['Invasion —'] ?? 0).toFixed(1)}`);

// What diplomacy actually produced, not just what it started.
console.log('\n--- diplomacy ---');
for (const [label, key] of [
  ['peace treaties per game   ', 'DIPLOMACY] Peace between'],
  ['ceasefires per game       ', 'DIPLOMACY] Ceasefire between'],
  ['alliances per game        ', 'DIPLOMACY] Alliance between'],
  ['treaties signed per game  ', 'DIPLOMACY] Treaty signed'],
  ['treaties cancelled / game ', 'DIPLOMACY] Cancelled'],
]) {
  console.log(`${label}: ${avg((g) => g.logCounts[key] ?? 0).toFixed(2)}`);
}
console.log(`civs with a navy at the end          : ${allCivs.filter((c) => c.ships + c.ferries > 0).length} / ${allCivs.length}`);

console.log(`\n(full data in ${OUT})`);
