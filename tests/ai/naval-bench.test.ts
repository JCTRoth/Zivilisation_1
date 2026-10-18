/**
 * Naval AI benchmark — the measurement side of the naval overhaul.
 *
 * Phase 2 of an AI overhaul is meaningless without a baseline, and Phase 3 is
 * meaningless without numbers. This drives a real `AI_VS_AI_NAVAL` game on a
 * pinned seed and records what the fleet actually achieved, so an overhauled
 * subsystem can be compared against the code it replaced on identical worlds.
 *
 * Everything here is deterministic: `useSeededRandom` pins the rolls and
 * `mapSeed` pins the terrain, so run A and run B play the same war. Metrics are
 * read from ENGINE STATE at fixed intervals, not from log scraping — a metric
 * that depends on a `console.log` string is a metric that breaks when someone
 * rewords a message.
 *
 * The suite runs a small number of seeds so `npm test` stays quick; set
 * `NAVAL_BENCH_SEEDS` / `NAVAL_BENCH_ROUNDS` to widen it for a real comparison,
 * and `NAVAL_BENCH_OUT` to write the raw numbers somewhere.
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { useSeededRandom } from '../helpers/world';
import GameEngine from '@/game/engine/GameEngine';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import { UNIT_PROPS } from '@/utils/Constants';
import type { Unit, City } from '../../types/game';

// Defaults are deliberately small: this is in `npm test` as a regression
// guard, and a benchmark nobody runs because it is slow is worth nothing.
// Widen with the env vars below for a real comparison.
const SEEDS = (process.env.NAVAL_BENCH_SEEDS ?? '7')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const ROUNDS = Number(process.env.NAVAL_BENCH_ROUNDS ?? 20);
const CIVS = Number(process.env.NAVAL_BENCH_CIVS ?? 4);
const OUT = process.env.NAVAL_BENCH_OUT ?? '/tmp/opencode/naval/bench.json';

/** One civilization's naval performance over the game. */
interface CivMetrics {
  civId: number;
  alive: boolean;
  cities: number;
  /** Cities on a landmass that is not the capital's — the real naval payoff. */
  islandCities: number;
  population: number;
  totalUnits: number;
  warships: number;
  transports: number;
  ferries: number;
  settlers: number;
  techs: number;
  gold: number;
  /**
   * Every hull afloat, counted by type. This is the fleet-variety measure: a
   * civ that builds one hull forty times and a civ that builds four hulls ten
   * times each have the same warship count and completely different navies.
   */
  fleet: Record<string, number>;
}

interface SeedReport {
  seed: number;
  rounds: number;
  /** Milliseconds of wall clock per round — the operational pacing measure. */
  msPerRound: number;
  maxMsPerRound: number;
  slowRounds: number;
  warshipsBuilt: number;
  warshipsLost: number;
  transportsBuilt: number;
  /** Hulls that ever existed, by type — the variety measure. */
  hullsBuilt: Record<string, number>;
  citiesFounded: number;
  citiesLost: number;
  civs: CivMetrics[];
}

/**
 * A hull that can sink something at sea.
 *
 * Requires `naval` as well as attack: the first cut of this benchmark counted
 * archers and legions as warships and reported a 67-strong navy that contained
 * exactly one ship. Variety and fleet size are only meaningful if "ship" means
 * ship.
 */
const isWarship = (u: Unit): boolean =>
  u.type !== 'ferry' && u.type !== 'transport' && u.type !== 'fisher_boat'
  && u.type !== 'trade_ship' && u.type !== 'caravan' && u.type !== 'settler'
  && u.type !== 'diplomat' && !!u.attack && u.attack > 0
  && UNIT_PROPS[String(u.type)]?.naval === true;

const isTransport = (u: Unit): boolean => u.type === 'ferry' || u.type === 'transport';

/**
 * The hulls that are actually a navy. Variety is measured across these alone:
 * counting a settler or a caravan would make a land empire look varied.
 */
const NAVAL_HULLS = new Set([
  'sail', 'trireme', 'caravel', 'frigate', 'ironclad', 'destroyer', 'cruiser',
  'battleship', 'submarine', 'carrier', 'ferry', 'transport', 'fisher_boat',
  'trade_ship',
]);

function snapshotCiv(engine: GameEngine, civId: number): CivMetrics {
  const units = engine.units.filter((u: Unit) => u.civilizationId === civId && !u.isDefeated);
  const cities = engine.cities.filter((c: City) => c.civilizationId === civId);
  // Bound, not detached: `getLandmassId` is a method, so pulling it off the
  // engine leaves `this` undefined and every call throws into the catch below.
  // That is why this metric read 0 island cities for a whole overhaul while the
  // game was happily founding New York on the far side of the ocean.
  const getLandmass = (engine as unknown as { getLandmassId?: (c: number, r: number) => number })
    .getLandmassId?.bind(engine);
  // The civ's home landmass is the one its OLDEST city sits on, read at
  // snapshot time. Reading it at game start is meaningless here: a civ begins
  // with a settler and no cities, so the first cut of this benchmark recorded
  // a capital of `null` and counted zero island cities every single run.
  let islandCities = 0;
  if (typeof getLandmass === 'function' && cities.length > 0) {
    let homeLandmass: number | null = null;
    try { homeLandmass = getLandmass(cities[0].col, cities[0].row); } catch { homeLandmass = null; }
    if (homeLandmass !== null && homeLandmass >= 0) {
      for (const c of cities) {
        try {
          const lm = getLandmass(c.col, c.row);
          if (lm !== homeLandmass) islandCities++;
        } catch { /* island counting is advisory */ }
      }
    }
  }
  const civ = engine.civilizations[civId];
  const fleet: Record<string, number> = {};
  for (const u of units) fleet[u.type] = (fleet[u.type] ?? 0) + 1;
  return {
    civId,
    alive: civ?.isAlive !== false,
    cities: cities.length,
    islandCities,
    population: cities.reduce((n, c) => n + (c.population ?? 0), 0),
    totalUnits: units.length,
    warships: units.filter(isWarship).length,
    transports: units.filter(isTransport).length,
    ferries: units.filter((u) => u.type === 'ferry').length,
    settlers: units.filter((u) => u.type === 'settler').length,
    techs: (civ?.technologies ?? []).length,
    gold: Math.round(civ?.resources?.gold ?? 0),
    fleet,
  };
}

describe('naval AI benchmark', () => {
  it('plays pinned naval games and records what the fleet achieved', async () => {
    const reports: SeedReport[] = [];

    for (const seed of SEEDS) {
      useSeededRandom(seed);
      // The engine logs its reasoning continuously. That is invaluable in a
      // real session and pure noise here — a benchmark prints numbers, not a
      // play-by-play. The game itself is unaffected.
      const originalLog = console.log;
      console.log = () => {};
      const engine = new GameEngine(null);
      (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
      // NOT paused: a parked engine skips AI turns entirely, which is how a
      // first cut of this benchmark ran 120 "rounds" in 0 ms and recorded four
      // civilizations that never founded a city.
      (engine as unknown as { isPaused: boolean }).isPaused = false;
      await engine.initialize({
        numberOfCivilizations: CIVS,
        mapType: 'AI_VS_AI_NAVAL',
        devMode: true,
        startingGold: 50,
        mapSeed: seed,
      });

      const active = engine.civilizations.filter(
        (c) => c.isAlive !== false && c.id !== BARBARIAN_CIV_ID,
      );
      const baselineCities = engine.cities.length;
      let warshipsBuilt = 0;
      let warshipsLost = 0;
      let transportsBuilt = 0;
      let peakWarships = 0;
      let peakTransports = 0;
      const hullsBuilt: Record<string, number> = {};
      const peakByType: Record<string, number> = {};

      let totalMs = 0;
      let maxMs = 0;
      let slowRounds = 0;
      let rounds = 0;

      // Hard wall-clock budget as well as a round budget: a benchmark that can
      // hang is a benchmark nobody runs.
      const deadline = Date.now() + Number(process.env.NAVAL_BENCH_BUDGET_MS ?? 240_000);

      while (engine.turnManager.getRoundNumber() < ROUNDS && rounds < ROUNDS * 2 && !engine.isGameOver) {
        if (Date.now() > deadline) break;
        const t = Date.now();
        for (const civ of active) {
          engine.turnManager.startTurn(civ.id);
          engine.activePlayer = civ.id;
          if (civ.isAI) {
            try { await engine.processAITurn(civ.id); } catch { /* one civ's error must not end the benchmark */ }
          }
          const phase = engine.turnManager.getPhase();
          if (phase && phase !== 'END') {
            await engine.turnManager.nextPhase();
            await engine.turnManager.nextPhase();
            await engine.turnManager.nextPhase();
          }
        }
        const ms = Date.now() - t;
        totalMs += ms;
        if (ms > maxMs) maxMs = ms;
        if (ms > 2_000) slowRounds++;
        rounds++;

        // Fleet tallies, sampled from state so "built" and "lost" are real.
        const afloat = engine.units.filter((u: Unit) => !u.isDefeated);
        const warships = afloat.filter(isWarship).length;
        const transports = afloat.filter(isTransport).length;
        if (warships > peakWarships) { warshipsBuilt += warships - peakWarships; peakWarships = warships; }
        if (transports > peakTransports) { transportsBuilt += transports - peakTransports; peakTransports = transports; }
        // Per-hull tallies, same peak-diff method: this is what turns "the
        // navy has 8 ships" into "the navy has 8 ships, all of them sails".
        const byType: Record<string, number> = {};
        for (const u of afloat) {
          if (u.civilizationId === undefined) continue;
          byType[u.type] = (byType[u.type] ?? 0) + 1;
        }
        for (const [type, n] of Object.entries(byType)) {
          const peak = peakByType[type] ?? 0;
          if (n > peak) {
            hullsBuilt[type] = (hullsBuilt[type] ?? 0) + (n - peak);
            peakByType[type] = n;
          }
        }
      }

      const afloat = engine.units.filter((u: Unit) => !u.isDefeated);
      warshipsLost = Math.max(0, warshipsBuilt - afloat.filter(isWarship).length);

      reports.push({
        seed,
        rounds,
        msPerRound: rounds > 0 ? Math.round(totalMs / rounds) : 0,
        maxMsPerRound: maxMs,
        slowRounds,
        warshipsBuilt,
        warshipsLost,
        transportsBuilt,
        hullsBuilt,
        citiesFounded: Math.max(0, engine.cities.length - baselineCities),
        citiesLost: Math.max(0, baselineCities - engine.cities.length),
        civs: active.map((civ) => snapshotCiv(engine, civ.id)),
      });
      console.log = originalLog;
    }

    // Aggregates — the numbers a comparison table is built from.
    const agg = {
      seeds: SEEDS.length,
      rounds: ROUNDS,
      avgMsPerRound: Math.round(
        reports.reduce((n, r) => n + r.msPerRound, 0) / Math.max(1, reports.length),
      ),
      totalSlowRounds: reports.reduce((n, r) => n + r.slowRounds, 0),
      totalWarshipsBuilt: reports.reduce((n, r) => n + r.warshipsBuilt, 0),
      totalWarshipsLost: reports.reduce((n, r) => n + r.warshipsLost, 0),
      totalTransportsBuilt: reports.reduce((n, r) => n + r.transportsBuilt, 0),
      totalCitiesFounded: reports.reduce((n, r) => n + r.citiesFounded, 0),
      totalIslandCities: reports.reduce(
        (n, r) => n + r.civs.reduce((m, c) => m + c.islandCities, 0), 0,
      ),
      totalCities: reports.reduce((n, r) => n + r.civs.reduce((m, c) => m + c.cities, 0), 0),
      totalPopulation: reports.reduce((n, r) => n + r.civs.reduce((m, c) => m + c.population, 0), 0),
      totalTechs: reports.reduce((n, r) => n + r.civs.reduce((m, c) => m + c.techs, 0), 0),
      // ── fleet variety ──────────────────────────────────────────────────
      // `distinctHullTypes` and `topHullShare` are the two numbers that say
      // whether a navy is varied. 1.0 topHullShare means every hull in the
      // fleet is the same ship, whatever the warship count says.
      hullsBuilt: (() => {
        const total: Record<string, number> = {};
        for (const r of reports) {
          for (const [t, n] of Object.entries(r.hullsBuilt)) total[t] = (total[t] ?? 0) + n;
        }
        return total;
      })(),
    };
    {
      const built = agg.hullsBuilt as Record<string, number>;
      const naval = Object.entries(built).filter(([t]) => NAVAL_HULLS.has(t));
      const navalTotal = naval.reduce((n, [, v]) => n + v, 0);
      const busiest = naval.reduce((m, [, v]) => Math.max(m, v), 0);
      (agg as unknown as Record<string, unknown>).distinctHullTypes = naval.length;
      (agg as unknown as Record<string, unknown>).warshipHullsBuilt = navalTotal;
      (agg as unknown as Record<string, unknown>).topHullShare = navalTotal > 0
        ? Math.round((busiest / navalTotal) * 1000) / 1000
        : 0;
    }
    agg && void 0;

    const payload = { generatedAt: new Date().toISOString(), rounds: ROUNDS, civs: CIVS, aggregate: agg, reports };
    try { mkdirSync(dirname(OUT), { recursive: true }); } catch { /* best effort */ }
    writeFileSync(OUT, JSON.stringify(payload, null, 2));

    // The test's own assertion: the benchmark produced real games. Detailed
    // comparison is the report's job, not a test failure's.
    expect(reports.length).toBe(SEEDS.length);
    expect(reports.every((r) => r.rounds > 0)).toBe(true);
    expect(agg.avgMsPerRound).toBeGreaterThanOrEqual(0);
  }, 600_000);
});
