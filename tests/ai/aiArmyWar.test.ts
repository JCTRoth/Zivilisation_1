/**
 * Test game: do massed AI armies actually attack?
 *
 * A pinned AI-vs-AI world is played round by round while the test watches the
 * one thing the army-management code is for: a civilization that masses a big
 * army must eventually take it to an enemy. It prints a telemetry table
 * (army size, attacks, captures, plan/group state per civilization) so a
 * failed run says exactly who hoarded units and did nothing, and why.
 *
 * Regression it guards (AIManager): army groups used to form from raw enemy
 * sightings while the committed offensive plan assigned only a few stragglers
 * (requiredUnits was a cap), so a 17-unit army gathered in waves and rarely
 * pressed. Groups now follow the plan target and every non-reserve combat unit
 * joins it — the same seed went from 41 to 72 attacks and 5 to 9 captures.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import GameEngine from '@/game/engine/GameEngine';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import { useSeededRandom } from '../helpers/world';

const TARGET_ROUNDS = 150;
const MAP_SEED = 982451;
const RNG_SEED = 77;
const CIVILIZATIONS = 4;
/** Hoarding threshold: an army this size must have seen combat. */
const BIG_ARMY = 6;

interface CivTelemetry {
  id: number;
  name: string;
  maxArmy: number;
  finalArmy: number;
  attacks: number;
  captures: number;
  warsStarted: number;
  /** Rounds in which this civ fielded >= BIG_ARMY combat units. */
  roundsWithBigArmy: number;
  /** …of those, rounds in which it made zero attacks. */
  roundsWithBigArmyNoAttack: number;
}

describe('AI war watch (test game)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('massed armies reach the enemy — no civ hoards forever', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    useSeededRandom(RNG_SEED);
    const engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    await engine.initialize({
      numberOfCivilizations: CIVILIZATIONS,
      mapType: 'AI_VS_AI',
      devMode: true,
      startingGold: 100,
      mapSeed: MAP_SEED,
    });

    const telemetry = new Map<number, CivTelemetry>();
    for (const civ of engine.civilizations) {
      if (civ.id === BARBARIAN_CIV_ID) continue;
      telemetry.set(civ.id, {
        id: civ.id,
        name: civ.name,
        maxArmy: 0,
        finalArmy: 0,
        attacks: 0,
        captures: 0,
        warsStarted: 0,
        roundsWithBigArmy: 0,
        roundsWithBigArmyNoAttack: 0,
      });
    }

    // Count every hostile act by its attacker so "who fought" is exact.
    engine.onStateChange = (type: string, data?: Record<string, unknown>) => {
      if (type === 'WAR_DECLARED') {
        const entry = telemetry.get(data?.aggressorId as number);
        if (entry) entry.warsStarted++;
        return;
      }
      const attackerId =
        (data?.attacker as { civilizationId?: number } | undefined)?.civilizationId ??
        (typeof data?.capturedBy === 'number' ? (data.capturedBy as number) : -1);
      const entry = telemetry.get(attackerId);
      if (!entry) return;
      if (
        type === 'COMBAT_VICTORY' ||
        type === 'COMBAT_HIT' ||
        type === 'COMBAT_DEFEAT' ||
        type === 'CITY_ATTACKED'
      ) {
        entry.attacks++;
      } else if (type === 'CITY_CAPTURED') {
        entry.captures++;
      }
    };

    /** What this civ's military machinery is doing right now. */
    const militaryState = (civId: number): string => {
      const storage = engine.getPlayerStorage(civId);
      const plan = storage?.turnData?.offensivePlan as
        | {
            target?: { col: number; row: number };
            requiredUnits?: number;
            assignedUnitIds?: string[];
            targetDefense?: number;
            roundPrepared?: number;
          }
        | null
        | undefined;
      const aiState = storage?.turnData?.aiState as
        | {
            armyGroups?: Array<{ status?: string; unitIds?: string[] }>;
            aggression?: { posture?: string; score?: number };
          }
        | undefined;
      const groups = aiState?.armyGroups ?? [];
      const groupText = groups.length
        ? groups.map((g) => `${g.status ?? '?'}(${g.unitIds?.length ?? 0})`).join('+')
        : '-';
      const planText = plan?.target
        ? `plan@${plan.target.col},${plan.target.row} req=${plan.requiredUnits ?? '?'}` +
          ` asg=${plan.assignedUnitIds?.length ?? 0} def=${Math.round(plan.targetDefense ?? 0)}`
        : 'no-plan';
      const posture = aiState?.aggression
        ? `${aiState.aggression.posture}(${Math.round(aiState.aggression.score ?? 0)})`
        : '?';
      return `${planText} groups=${groupText} ${posture}`;
    };

    const timeline: string[] = [];
    const maxIterations = 900;
    let iterations = 0;
    let lastBuckets = -1;

    while (
      engine.turnManager.getRoundNumber() < TARGET_ROUNDS &&
      iterations < maxIterations &&
      !engine.isGameOver
    ) {
      iterations++;
      const attacksBefore = new Map([...telemetry].map(([id, t]) => [id, t.attacks]));
      const activeCivs = engine.civilizations.filter(
        (c) => c.isAlive !== false && c.id !== BARBARIAN_CIV_ID,
      );
      for (const civ of activeCivs) {
        // Hard guard against a runaway auto-play chain: never overshoot.
        if (engine.turnManager.getRoundNumber() > TARGET_ROUNDS + 10) break;
        engine.turnManager.startTurn(civ.id);
        engine.activePlayer = civ.id;
        if (civ.isAI) {
          try {
            await engine.processAITurn(civ.id);
          } catch {
            // A thrown turn must not hide the telemetry we are here for.
          }
        }
        if (engine.turnManager.getPhase() && engine.turnManager.getPhase() !== 'END') {
          await engine.turnManager.nextPhase();
          await engine.turnManager.nextPhase();
          await engine.turnManager.nextPhase();
        }
      }

      // Sample army sizes + idle-army counters once per round.
      for (const [id, entry] of telemetry) {
        const army = engine.units.filter(
          (u) => u.civilizationId === id && !u.isDefeated && (u.attack ?? 0) > 0,
        ).length;
        entry.maxArmy = Math.max(entry.maxArmy, army);
        entry.finalArmy = army;
        if (army >= BIG_ARMY) {
          entry.roundsWithBigArmy++;
          if (entry.attacks === (attacksBefore.get(id) ?? 0)) {
            entry.roundsWithBigArmyNoAttack++;
          }
        }
      }

      // One compact timeline line per 10 rounds of engine time.
      const bucket = Math.floor(engine.turnManager.getRoundNumber() / 10);
      if (bucket > lastBuckets) {
        lastBuckets = bucket;
        const cells = [...telemetry.values()].map(
          (t) =>
            `${t.name.slice(0, 3)}:${t.finalArmy}u/${t.attacks}a/${t.captures}c` +
            (t.finalArmy >= BIG_ARMY ? `[${militaryState(t.id).replace(/ profile=[^ ]+/, '')}]` : ''),
        );
        timeline.push(`r${engine.turnManager.getRoundNumber()} ${cells.join(' ')}`);
      }
    }

    // ── Telemetry (restore logging first so a run is observable) ─────────
    // Stop the engine before reporting: nothing may keep playing behind the
    // test (AI-vs-AI has no human turn to yield to).
    engine.isPaused = true;
    engine.onStateChange = null;
    logSpy.mockRestore();
    console.log('AI war watch — army vs attacks');
    console.log(`rounds played: ${engine.turnManager.getRoundNumber()}`);
    for (const line of timeline) console.log(`  ${line}`);
    console.log('  civ              maxArmy  final  attacks  captures  wars  bigArmyRds  idleBigRds');
    for (const t of telemetry.values()) {
      console.log(
        `  ${t.name.padEnd(16)} ${String(t.maxArmy).padStart(5)} ${String(t.finalArmy).padStart(6)} ` +
          `${String(t.attacks).padStart(7)} ${String(t.captures).padStart(8)} ${String(t.warsStarted).padStart(5)} ` +
          `${String(t.roundsWithBigArmy).padStart(9)} ${String(t.roundsWithBigArmyNoAttack).padStart(10)}`,
      );
    }
    const hoarders = [...telemetry.values()].filter(
      (t) => t.maxArmy >= BIG_ARMY && t.attacks === 0 && t.captures === 0,
    );
    console.log(
      hoarders.length === 0
        ? '  no civ massed an army without attacking'
        : `  HOARDERS: ${hoarders.map((t) => `${t.name} (max ${t.maxArmy})`).join(', ')}`,
    );
    writeFileSync(
      '/tmp/opencode/ai-war-watch.txt',
      [
        `rounds: ${engine.turnManager.getRoundNumber()}`,
        ...timeline,
        ...[...telemetry.values()].map(
          (t) =>
            `${t.name}: max ${t.maxArmy}, final ${t.finalArmy}, attacks ${t.attacks}, captures ${t.captures}, ` +
            `wars ${t.warsStarted}, bigArmyRounds ${t.roundsWithBigArmy}, idleBigRounds ${t.roundsWithBigArmyNoAttack}`,
        ),
      ].join('\n'),
    );

    // The claim of this test game: an army that big must see combat.
    expect(
      hoarders.map((t) => `${t.name}: max ${t.maxArmy} units, 0 attacks`),
      'civs massed a big army but never attacked',
    ).toEqual([]);
  });
});
