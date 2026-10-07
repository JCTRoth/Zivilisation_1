/**
 * Idle unit-turns: how much of the AI's army and settlers actually does
 * something.
 *
 * The measurement came out of a bug report ("settlers stand around idle"), and
 * the first version of it was wrong in a way worth keeping: it counted a unit as
 * idle whenever its position, work target and work timer were unchanged across a
 * turn — which also counts a **fortified garrison**, sitting still *because* it
 * is defending the city. That inflated the headline to 66 % of all unit-turns,
 * most of it phalanxes and archers doing their job.
 *
 * So the rule here is explicit about what "idle" means:
 *
 *  - a unit is **parked deliberately** when it is fortified or asleep — a
 *    defender holding a city, a scout resting. Not idle.
 *  - a unit is **idle** when it moved nowhere, worked nothing, and was not
 *    parked on purpose. That is a turn spent for nothing.
 *
 * Settlers are reported separately because they have no legitimate parked
 * state: a settler that is not founding, building or walking is wasted.
 */
import { describe, expect, it } from 'vitest';
import { makeEngine, useSeededRandom } from './helpers/world';

interface UnitSnapshot {
  col: number;
  row: number;
  workTarget: string;
  workTurns: number;
  fortified: boolean;
  asleep: boolean;
  defeated: boolean;
}

interface IdleTally {
  unitTurns: number;
  idle: number;
  parked: number;
  byType: Record<string, { idle: number; parked: number; turns: number }>;
}

function snapshot(units: readonly any[]): Map<string, UnitSnapshot> {
  return new Map(units.map(u => [u.id, {
    col: u.col,
    row: u.row,
    workTarget: u.workTarget ?? '',
    workTurns: u.workTurns ?? 0,
    fortified: u.isFortified === true,
    asleep: u.isSleeping === true,
    defeated: u.isDefeated === true,
  }]));
}

/**
 * Run `turns` civ-turns of a pinned AI-vs-AI game and classify every unit-turn.
 *
 * Seeded: combat and several AI decisions use `Math.random`, so without a seed
 * the same map produces a different war each run and the number is not a number,
 * it is a sample.
 */
async function measureIdle(turns: number, seed = 4242): Promise<IdleTally> {
  useSeededRandom(seed);
  const world = await makeEngine({ mapType: 'AI_VS_AI', numberOfCivilizations: 4, seed: 777 });
  const engine = world.engine as any;

  const tally: IdleTally = {
    unitTurns: 0, idle: 0, parked: 0, byType: {},
  };

  for (let t = 1; t <= turns; t++) {
    const before = snapshot(engine.units ?? []);
    await world.runTurns(1);
    const after = snapshot(engine.units ?? []);

    for (const [id, prev] of before) {
      const unit = (engine.units ?? []).find((u: any) => u.id === id);
      if (!unit) continue; // consumed: founded, joined, or completed something
      // A DEFEATED unit is not idling — it is a corpse waiting out the 1.5 s
      // removal delay before the death animation finishes. The turn queue,
      // targeting, movement and combat all skip it (see
      // DEFEATED_UNIT_REMOVAL_DELAY_MS); counting it here would measure the
      // removal timer, not lazy settlers. One dead settler lingering for a
      // sub-1.5-second test run used to be two thirds of the whole score.
      if (unit.isDefeated || prev.defeated) continue;
      const now = after.get(id)!;
      const bucket = tally.byType[unit.type] ??= { idle: 0, parked: 0, turns: 0 };
      bucket.turns++;
      tally.unitTurns++;

      const acted = now.col !== prev.col
        || now.workTarget !== ''
        || now.workTurns !== 0;
      if (acted) continue;

      if (now.fortified || now.asleep) {
        tally.parked++;
        bucket.parked++;
      } else {
        tally.idle++;
        bucket.idle++;
      }
    }
  }
  return tally;
}

describe('idle unit-turns', () => {
  it('does not count a fortified garrison as idle', async () => {
    const tally = await measureIdle(40);

    // A parked defender is doing a job. If this ever reads zero the flag is not
    // being read and every number below is meaningless.
    expect(tally.parked).toBeGreaterThan(0);
    expect(tally.idle).toBeLessThan(tally.unitTurns - tally.parked);
  }, 600_000);

  it('accounts for every unit-turn exactly once', async () => {
    const tally = await measureIdle(40);
    const summed = Object.values(tally.byType)
      .reduce((n, b) => n + b.idle + b.parked, 0);
    const typeTurns = Object.values(tally.byType).reduce((n, b) => n + b.turns, 0);
    expect(summed).toBe(tally.idle + tally.parked);
    expect(typeTurns).toBe(tally.unitTurns);
  }, 600_000);

  // Was `it.fails` while the bug was open (it passed *because* the settlers
  // were still idle, and turned red to say "promote me"). The cause was
  // `resetUnitsForPlayer` living only in `advanceTurn`, so a harness that
  // drives `startTurn(civ)` per civ reset one player per round and everyone
  // else's settlers kept 0 moves and never reached the site their own search
  // had already picked. With the reset moved into `startTurn` the share is
  // 25.8 %, so this is a plain `it` again.
  it('keeps settlers from standing still — the bug this metric was built for', async () => {
    const tally = await measureIdle(120);
    const settlers = tally.byType.settler;

    // Before the ladder got a bottom, this was 409 idle turns out of 435
    // (94 %) and not one settler founded anything.
    expect(settlers, 'settlers should exist in this scenario').toBeDefined();
    const idleShare = settlers.idle / Math.max(1, settlers.turns);
    expect(idleShare, `settler idle share was ${(idleShare * 100).toFixed(1)}%`).toBeLessThan(0.35);
  }, 900_000);
});
