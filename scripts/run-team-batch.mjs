#!/usr/bin/env node
/**
 * Fixed-alliance verification batch (team coordination, Phases 1-4).
 *
 * Runs the SAME seeds three ways — free-for-all (baseline), 2v2 and 3v1 —
 * through the canonical `makeEngine`/`runTurns` harness (real fog of war, so
 * the coordinator's claims and war plans are actually exercised) and reports
 * what the TeamCoordinator actually did:
 *
 *   * convergence: how many member bulk plans hit the team's joint primary,
 *   * scout coordination: claim yields / fallback picks per round,
 *   * knowledge spread within a team over time (tech convergence),
 *   * broke-member rounds (< RECONCILE_GOLD_FLOOR, the gold bootstrap's job),
 *   * defense directives issued and whether those cities still stand,
 *   * war/capture/invasion activity plus economy tripwires (bankrupt rounds,
 *     disbands) so a regression in the baseline shows up immediately.
 *
 * Usage:
 *   node scripts/run-team-batch.mjs [gamesPerConfig] [rounds] [outJson]
 *     gamesPerConfig  games per configuration (default 3)
 *     rounds          rounds per game        (default 150)
 *
 * Example:
 *   node scripts/run-team-batch.mjs 3 150 /tmp/team-batch.json
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = Number(process.argv[2] ?? 3);
const ROUNDS = Number(process.argv[3] ?? 150);
const OUT = process.argv[4] ?? '/tmp/team-batch.json';
const MAP_TYPE = 'AI_VS_AI';
const SEEDS = [7, 19, 33, 51, 64, 88, 101, 129, 142, 177, 190, 210, 233, 246, 259, 271, 288, 301, 314, 327];

/** Same seeds in every configuration: paired comparisons, not luck. */
const CONFIGS = [
  { label: 'FFA', assignments: null },
  { label: '2v2', assignments: [0, 1, 0, 1] },
  { label: '3v1', assignments: [0, 0, 0, 1] },
];

const spec = `
import { describe, it, expect, vi } from 'vitest';
import { makeEngine, useSeededRandom } from '../helpers/world';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';

const ROUNDS = ${ROUNDS};
const SEEDS = ${JSON.stringify(SEEDS.slice(0, GAMES))};
const CONFIGS = ${JSON.stringify(CONFIGS)};
const MAP_TYPE = ${JSON.stringify(MAP_TYPE)};
const RECONCILE_GOLD_FLOOR = 80;

describe('team batch', () => {
  it('plays the batch', async () => {
    const orig = console.log;
    const results: unknown[] = [];

    for (const config of CONFIGS) {
      for (const seed of SEEDS) {
        orig('START ' + config.label + ' seed ' + seed);
        useSeededRandom(seed);
        const world = await makeEngine({
          seed,
          mapType: MAP_TYPE,
          numberOfCivilizations: 4,
          startingGold: 50,
          fixedAlliances: !!config.assignments,
          teamAssignments: config.assignments ?? undefined,
        });
        const e = world.engine;
        const active = e.civilizations.filter(
          (c) => c.isAlive !== false && c.id !== BARBARIAN_CIV_ID,
        );

        // Telemetry: bulk-attack plans (with their targets) and the usual
        // activity/capture tallies. Installed after initialize, chained.
        const bulkPlans: Array<{ round: number; civId: number; col: number; row: number }> = [];
        const logActions: Record<string, number> = {};
        const prevOSC = e.onStateChange;
        e.onStateChange = (type: string, data: any, ...rest: unknown[]) => {
          if (type === 'GAME_LOG') {
            const a = data?.action ?? 'msg';
            logActions[a] = (logActions[a] ?? 0) + 1;
            if (a === 'bulk_attack' && typeof data?.targetCol === 'number') {
              bulkPlans.push({
                round: e.turnManager.getRoundNumber(),
                civId: data.civilizationId ?? -1,
                col: data.targetCol,
                row: data.targetRow,
              });
            }
          } else if (type === 'CITY_FOUNDED' || type === 'CITY_CAPTURED'
            || type === 'CITY_DESTROYED' || type === 'UNIT_DEFEATED'
            || type === 'UNIT_DISBANDED' || type === 'CITY_STARVED') {
            logActions[type] = (logActions[type] ?? 0) + 1;
          }
          return typeof prevOSC === 'function' ? prevOSC(type, data, ...rest) : undefined;
        };

        const logCounts: Record<string, number> = {};
        console.log = (...a: unknown[]) => {
          const s = String(a[0] ?? '');
          for (const key of [
            'Invasion —', 'declares war', 'DIPLOMACY] Civ',
            'DIPLOMACY] Peace between', 'DIPLOMACY] Ceasefire between',
            'colony', 'ferry', 'disband',
          ]) {
            if (s.includes(key)) logCounts[key] = (logCounts[key] ?? 0) + 1;
          }
        };

        // ── Team metrics, sampled once per round ─────────────────────────
        const teamIds = e.teamManager.enabled ? e.teamManager.getTeamIds() : [];
        const metrics = {
          claimYields: 0,
          fallbackPicks: 0,
          sampledRounds: 0,
          roundsWithPlan: 0,
          memberPlans: 0,
          convergedMemberPlans: 0,
          brokeMemberRounds: 0,
          techSpreadSum: 0,
          techSpreadRounds: 0,
          defenseDirectives: 0,
        };
        const trackedDefense = new Map<string, { ownerCivId: number; firstRound: number }>();
        const techSpreadTimeline: Array<{ round: number; spread: number }> = [];
        let bankruptCivTurns = 0;
        let minGold = Infinity;

        for (let i = 0; i < ROUNDS && !e.isGameOver; i++) {
          await world.runTurns(1);
          const round = e.turnManager.getRoundNumber();
          metrics.sampledRounds = (metrics.sampledRounds ?? 0) + 1;
          const diag = e.teamCoordinator.diagnostics;
          metrics.claimYields += diag.claimYields;
          metrics.fallbackPicks += diag.fallbackPicks;

          for (const teamId of teamIds) {
            const members = e.teamManager.getTeamMembers(teamId);
            const plan = e.teamCoordinator.getTeamWarPlan(teamId);
            if (plan) {
              metrics.roundsWithPlan++;
              for (const m of members) {
                const storage = e.getPlayerStorage(m);
                const op = storage?.turnData?.offensivePlan as
                  | { target?: { col: number; row: number } }
                  | undefined;
                if (op?.target) {
                  metrics.memberPlans++;
                  if (op.target.col === plan.primary.col && op.target.row === plan.primary.row) {
                    metrics.convergedMemberPlans++;
                  }
                }
              }
            }
            const techs = members.map((m) => (e.civilizations[m]?.technologies ?? []).length);
            if (techs.length > 1) {
              const spread = Math.max(...techs) - Math.min(...techs);
              metrics.techSpreadSum += spread;
              metrics.techSpreadRounds++;
              if (round % 25 === 0) techSpreadTimeline.push({ round, spread });
            }
            for (const m of members) {
              const gold = e.civilizations[m]?.resources?.gold ?? 0;
              if (gold < RECONCILE_GOLD_FLOOR) metrics.brokeMemberRounds++;
              if (gold < minGold) minGold = gold;
              if (gold < 0) bankruptCivTurns++;
            }
            for (const d of e.teamCoordinator.getTeamDefenseDirectives(teamId)) {
              metrics.defenseDirectives++;
              if (!trackedDefense.has(d.cityId)) {
                trackedDefense.set(d.cityId, { ownerCivId: d.ownerCivId, firstRound: round });
              }
            }
          }
        }

        console.log = orig;
        const finalRound = e.turnManager.getRoundNumber();

        // Defense outcomes: does the city still stand with its owner at the end?
        const defenseOutcomes = [...trackedDefense.entries()].map(([cityId, info]) => {
          const city = e.cities.find((c) => c.id === cityId);
          return {
            cityId,
            ownerCivId: info.ownerCivId,
            roundsTracked: finalRound - info.firstRound,
            survived: !!city && city.civilizationId === info.ownerCivId,
          };
        });

        // Team exploration (shared vision): union of the members' explored area.
        const exploredPct = (memberIds: number[]): number => {
          const w = e.map?.width;
          const h = e.map?.height;
          if (!w || !h) return 0;
          const union = new Uint8Array(w * h);
          for (const id of memberIds) {
            const src = e.getPlayerStorage(id)?.explored;
            if (!src) continue;
            const limit = Math.min(src.length, union.length);
            for (let k = 0; k < limit; k++) if (src[k]) union[k] = 1;
          }
          let known = 0;
          for (let k = 0; k < union.length; k++) if (union[k]) known++;
          return Math.round((known / union.length) * 100);
        };

        const teamsFinal = teamIds.map((teamId) => {
          const members = e.teamManager.getTeamMembers(teamId);
          const memberTechs = members.map((m) => (e.civilizations[m]?.technologies?.length ?? 0));
          return {
            teamId,
            alive: e.teamManager.isTeamAlive(teamId),
            exploredPct: exploredPct(members),
            cities: e.cities.filter((c) => members.includes(c.civilizationId)).length,
            pop: e.cities.filter((c) => members.includes(c.civilizationId))
              .reduce((n, c) => n + (c.population ?? 0), 0),
            techs: memberTechs.reduce((n, t) => n + t, 0),
            techSpread: memberTechs.length > 1
              ? Math.max(...memberTechs) - Math.min(...memberTechs)
              : 0,
          };
        });

        results.push({
          config: config.label,
          seed,
          rounds: finalRound,
          gameOver: e.isGameOver === true,
          enabled: e.teamManager.enabled,
          metrics,
          bulkPlans,
          techSpreadTimeline,
          defenseOutcomes,
          teamsFinal,
          logActions,
          logCounts,
          bankruptCivTurns,
          minGold: minGold === Infinity ? 0 : minGold,
        });
        orig('DONE ' + config.label + ' seed ' + seed + ' round ' + finalRound);
      }
    }

    vi.restoreAllMocks();
    require('node:fs').writeFileSync(${JSON.stringify(OUT)}, JSON.stringify(results));
    orig('TEAM_BATCH_DONE ' + results.length);
    expect(true).toBe(true);
  }, ${GAMES * CONFIGS.length * 250 * 1000});
});
`;

const specPath = join(ROOT, 'tests', 'ai', 'teamBatchRun.test.ts');
writeFileSync(specPath, spec);
const cleanup = () => { try { rmSync(specPath, { force: true }); } catch { /* ignore */ } };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

const res = spawnSync(
  'npx',
  ['vitest', 'run', 'tests/ai/teamBatchRun.test.ts', '--no-file-parallelism'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 128 },
);
cleanup();

if (!existsSync(OUT)) {
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  console.error(out.split('\n').slice(-40).join('\n'));
  console.error(`\nNo batch output at ${OUT} — the run did not finish.`);
  process.exit(res.status ?? 1);
}

// Replay the per-game progress markers from the buffered vitest output.
for (const line of (res.stdout ?? '').split('\n')) {
  if (line.includes('START ') || line.includes('DONE ') || line.includes('TEAM_BATCH_DONE')) {
    console.log(line.replace(/^.*?(START |DONE |TEAM_BATCH_DONE)/, '$1'));
  }
}

const games = JSON.parse(readFileSync(OUT, 'utf8'));

// ── Report ────────────────────────────────────────────────────────────────
const avg = (list, fn) => (list.length ? list.reduce((n, x) => n + fn(x), 0) / list.length : 0);
const pad = (s, n) => String(s).padEnd(n);
const pct = (v) => `${(v * 100).toFixed(0)}%`.padStart(5);

console.log(`\n=== team verification · ${ROUNDS} rounds · 4 civs · paired seeds ===\n`);
console.log(
  'config  games  caps  converge  yields/smp  fallbacks  techSpread  brokeRnds  defDirs  defSaved',
);

for (const config of CONFIGS) {
  const subset = games.filter((g) => g.config === config.label);
  if (subset.length === 0) continue;
  const sum = (fn) => subset.reduce((n, g) => n + fn(g), 0);
  const caps = sum((g) => g.logActions.CITY_CAPTURED ?? 0);
  const memberPlans = sum((g) => g.metrics.memberPlans);
  const converge = memberPlans > 0 ? sum((g) => g.metrics.convergedMemberPlans) / memberPlans : 0;
  const sampled = sum((g) => g.metrics.sampledRounds) || 1;
  const yieldsPerSample = sum((g) => g.metrics.claimYields) / sampled;
  const fallbacks = sum((g) => g.metrics.fallbackPicks);
  const techSpread = avg(subset, (g) => (g.metrics.techSpreadRounds ? g.metrics.techSpreadSum / g.metrics.techSpreadRounds : 0));
  const broke = sum((g) => g.metrics.brokeMemberRounds);
  const defDirs = sum((g) => g.metrics.defenseDirectives);
  const defSaved = subset.flatMap((g) => g.defenseOutcomes).filter((o) => o.survived).length;
  const defTotal = subset.flatMap((g) => g.defenseOutcomes).length;

  console.log(
    `${pad(config.label, 8)}${pad(subset.length, 7)}${pad(caps, 5)}${pct(converge).padStart(10)}` +
    `${pad(yieldsPerSample.toFixed(1), 13)}${pad(fallbacks, 11)}${pad(techSpread.toFixed(2), 12)}` +
    `${pad(broke, 10)}${pad(defDirs, 8)}${pad(`${defSaved}/${defTotal}`, 9)}`,
  );
}

console.log('\n--- per game (team finals) ---');
for (const g of games) {
  const teams = (g.teamsFinal ?? [])
    .map((t) => `T${t.teamId + 1}${t.alive ? '' : '(dead)'}: ${t.cities}c/${t.pop}p/${t.techs}t exp${t.exploredPct}% spread${t.techSpread}`)
    .join('  ');
  console.log(`${pad(g.config, 6)}${pad(g.seed, 6)} r${g.rounds}  ${teams}`);
}

const spreadNow = (label) => {
  const subset = games.filter((g) => g.config === label);
  const early = avg(subset.flatMap((g) => g.techSpreadTimeline.filter((p) => p.round <= 50)), (p) => p.spread);
  const late = avg(subset.flatMap((g) => g.techSpreadTimeline.filter((p) => p.round >= ROUNDS - 25)), (p) => p.spread);
  return `${early.toFixed(2)} -> ${late.toFixed(2)}`;
};
console.log(`\ntech spread within teams (max-min) round<=50 -> last 25:`);
for (const config of CONFIGS) {
  if (config.assignments) console.log(`  ${config.label}: ${spreadNow(config.label)}`);
}
