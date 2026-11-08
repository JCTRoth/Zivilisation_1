/**
 * AI ↔ Nomads — the two sides using each other.
 *
 * The ruler AI and the tribe are neighbours, not enemies: the AI hires the
 * riders, buys the knowledge they broker, and rides around their camp. An
 * unprovoked blow is the one thing that must never happen — first blood
 * turns the tribe angry at the court that drew it (`NomadManager.wasAttacked`)
 * and the whole relationship collapses into raids.
 *
 * Pinned here:
 *   * `AIUtility.isHostileTo` — the ONE predicate behind every AI attack:
 *     barbarians always, rivals at war, the nomad tribe only when it has
 *     turned or this civ's committed war plan names it,
 *   * a neutral camp is not a city threat (it would pull the garrison out
 *     and cancel offensives for a camp that cannot strike),
 *   * the AI never strikes a peaceful camp standing on its own tile, and
 *     long all-AI runs stay unprovoked while the tribe keeps dealing,
 *   * the tribe's own side: an AI court buys the group at its gate when it
 *     has a use for the soldiers (`NomadManager.aiHireThreshold`).
 */
import { describe, expect, it } from 'vitest';
import { makeEngine, useSeededRandom, type TestWorld } from '../helpers/world';
import { AIUtility } from '@/game/engine/AI/AIUtility';
import { collectCityThreatSamples } from '@/game/engine/AI/AIStrategy';
import { NOMAD_CIV_ID } from '@/data/NomadConstants';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import type { Unit } from '../../types/game';

type Engine = TestWorld['engine'];

const nomadUnits = (engine: Engine): Unit[] =>
  engine.units.filter((u) => u.civilizationId === NOMAD_CIV_ID && !u.isDefeated);

/** A combat unit of `civId` standing on a free land tile near (col,row). */
function soldier(world: TestWorld, civId: number, col: number, row: number, id: string): Unit {
  return world.spawnUnit({ id, type: 'warrior', civilizationId: civId, col, row });
}

/** A neutral nomad rider (not part of any camp, so nothing moves it). */
function nomad(world: TestWorld, col: number, row: number, id: string): Unit {
  return world.spawnUnit({ id, type: 'nomad_foot_warrior', civilizationId: NOMAD_CIV_ID, col, row });
}

describe('AI ↔ nomads — the hostility predicate', () => {
  it('a rival needs a war, the barbarians never do, and the tribe only when it has turned', async () => {
    const world = await makeEngine({ numberOfCivilizations: 3, seed: 4242, humanPlayerIds: [] });
    const e = world.engine;

    // Real civs: hostile only at war.
    expect(AIUtility.isHostileTo(e, 0, 1), 'at peace with a rival').toBe(false);
    e.diplomacyManager?.declareWar(0, 1);
    expect(AIUtility.isHostileTo(e, 0, 1), 'at war with a rival').toBe(true);
    expect(AIUtility.isHostileTo(e, 1, 0), 'the war is mutual').toBe(true);

    // The barbarian faction has no diplomacy relation — always hostile.
    expect(AIUtility.isHostileTo(e, 0, BARBARIAN_CIV_ID)).toBe(true);

    // The neutral tribe: not at war with anybody, so not a target.
    expect(AIUtility.isHostileTo(e, 0, NOMAD_CIV_ID), 'a peaceful camp').toBe(false);
    expect(AIUtility.isHostileTo(e, 0, 0), 'never yourself').toBe(false);
    expect(AIUtility.isHostileTo(e, 0, null), 'never nothing').toBe(false);
  });

  it('the tribe becomes a target only through a deliberate decision', async () => {
    const world = await makeEngine({ numberOfCivilizations: 3, seed: 4242, humanPlayerIds: [] });
    const e = world.engine;
    expect(AIUtility.isHostileTo(e, 0, NOMAD_CIV_ID)).toBe(false);

    // (a) our committed war plan names the camp — the "complex calculation"
    //     that starts every other war this civ fights.
    const storage = e.getPlayerStorage(0)!;
    (storage.turnData as Record<string, unknown>).offensivePlan = {
      targetCivId: NOMAD_CIV_ID,
      target: { col: 4, row: 4 },
      targetType: 'unit',
      roundPrepared: 1,
    } as never;
    expect(AIUtility.isHostileTo(e, 0, NOMAD_CIV_ID), 'the plan names them').toBe(true);
    expect(AIUtility.isHostileTo(e, 1, NOMAD_CIV_ID), 'only the planner\u2019s civ').toBe(false);
    delete (storage.turnData as Record<string, unknown>).offensivePlan;

    // (b) the tribe has turned angry and is raiding.
    const spot = world.landNear(10, 10, 8);
    world.settle('Haven', spot.col, spot.row, 0, 1);
    e.nomadManager.processRound(4); // the camp appears
    expect(e.nomadManager.isAngry, 'a fresh camp is neutral').toBe(false);
    nomadUnits(e)[0].health = 60; // first blood
    e.nomadManager.processRound(5);
    expect(e.nomadManager.isAngry, 'injured camp turns angry').toBe(true);
    expect(AIUtility.isHostileTo(e, 0, NOMAD_CIV_ID), 'an angry tribe is a target').toBe(true);
  });
});

describe('AI ↔ nomads — the ruler AI leaves a peaceful camp alone', () => {
  it('a neutral camp beside a city is not a threat sample', async () => {
    const world = await makeEngine({ numberOfCivilizations: 3, seed: 4242, humanPlayerIds: [] });
    const e = world.engine;
    const spot = world.landNear(10, 10, 8);
    const city = world.settle('Haven', spot.col, spot.row, 0, 1);
    const storage = e.getPlayerStorage(0)!;
    const camp = nomad(world, city.col + 1, city.row, 'camp-1');

    const samples = () => collectCityThreatSamples(e, city, 0, storage, 5);
    expect(
      samples().some((s) => s.col === camp.col && s.row === camp.row),
      'a peaceful camp is a visitor, not a siege',
    ).toBe(false);

    // Once the tribe has turned, the same camp counts.
    e.nomadManager.processRound(4); // the camp appears beside the court
    const rider = nomadUnits(e).find((u) => u.id !== camp.id);
    expect(rider, 'the camp raised its own riders').toBeDefined();
    rider!.health = 60; // first blood
    e.nomadManager.processRound(5);
    expect(e.nomadManager.isAngry).toBe(true);
    expect(
      samples().some((s) => s.col === camp.col && s.row === camp.row),
      'an angry camp is a siege',
    ).toBe(true);
  });

  it('an AI unit with a nomad stacked on its own tile does not swing first', async () => {
    const world = await makeEngine({ numberOfCivilizations: 3, seed: 4242, humanPlayerIds: [] });
    const e = world.engine;
    const spot = world.landNear(10, 10, 8);
    const city = world.settle('Haven', spot.col, spot.row, 0, 1);

    const defender = soldier(world, 0, city.col, city.row, 'ai-1');
    const rider = nomad(world, city.col, city.row, 'nomad-stacked');
    const healthBefore = rider.health;

    const events: Array<{ type: string; data: any }> = [];
    (e as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    await world.runTurns(3);

    expect(rider.isDefeated, 'the camp is still standing').toBeFalsy();
    expect(rider.health, 'nobody drew first blood').toBe(healthBefore);
    expect(
      events.filter(
        (ev) => (ev.type === 'COMBAT_VICTORY' || ev.type === 'COMBAT_HIT')
          && ev.data?.defender?.civilizationId === NOMAD_CIV_ID
          && (ev.data?.attacker?.civilizationId ?? -1) >= 0,
      ),
      'the AI never strikes the tribe by accident',
    ).toHaveLength(0);
    expect(defender.isDefeated).toBeFalsy();
  });
});

describe('AI ↔ nomads — long all-AI run', () => {
  it('stays unprovoked while the tribe keeps dealing with the courts', async () => {
    useSeededRandom(4242);
    const world = await makeEngine({
      numberOfCivilizations: 4, seed: 4242, humanPlayerIds: [],
    });
    const e = world.engine;
    for (let i = 0; i < 4; i++) {
      const t = world.landNear(6 + i * 7, 6 + (i % 2) * 10, 8);
      world.settle(`C${i}`, t.col, t.row, i, 2);
    }

    const events: Array<{ type: string; data: any }> = [];
    (e as any).onStateChange = (type: string, data: any) => events.push({ type, data });

    let angrySince = -1;
    let unprovoked = 0;
    let knowledge = 0;
    for (let r = 1; r <= 60; r++) {
      await world.runTurns(1);
      if (angrySince < 0 && events.some((ev) => ev.type === 'NOMAD_ANGRY')) angrySince = r;
      knowledge += events.filter((ev) => ev.type === 'NOMAD_KNOWLEDGE').length;
      for (const ev of events) {
        if (ev.type !== 'COMBAT_VICTORY' && ev.type !== 'COMBAT_HIT' && ev.type !== 'COMBAT_DEFEAT') continue;
        if (ev.data?.defender?.civilizationId !== NOMAD_CIV_ID) continue;
        if ((ev.data?.attacker?.civilizationId ?? -1) < 0) continue;
        if (angrySince < 0) unprovoked += 1;
      }
      events.length = 0;
    }

    expect(
      unprovoked,
      `the AI struck a neutral camp${angrySince < 0 ? '' : ' before the tribe turned angry'}`,
    ).toBe(0);
    expect(knowledge, 'the courts buy what the tribe brokers').toBeGreaterThanOrEqual(1);
    expect(
      e.diplomacyManager?.isAtWar?.(1, NOMAD_CIV_ID)
        || e.diplomacyManager?.isAtWar?.(0, NOMAD_CIV_ID),
      'nobody declares war on a phantom seat',
    ).toBeFalsy();
  }, 120_000);
});

describe('AI ↔ nomads — the tribe uses the ruler AI', () => {
  it('a court buys the group at its gate when it has a use for the soldiers', async () => {
    const world = await makeEngine({ numberOfCivilizations: 3, seed: 4242, humanPlayerIds: [] });
    const e = world.engine;
    const spot = world.landNear(10, 10, 8);
    world.settle('Haven', spot.col, spot.row, 0, 1);
    const nm = e.nomadManager;
    const threshold = (nm as unknown as {
      aiHireThreshold: (ai: unknown, aiId: number) => number;
    }).aiHireThreshold;

    const court = e.civilizations[1];
    const rival = e.civilizations[2];

    // A court with a war on wants the spears: the gate sale goes at good odds.
    court.warWith = new Set([2]);
    expect(threshold.call(nm, court, 1), 'a court at war buys readily').toBeLessThan(0.9);

    // A peacetime court that can field an army of its own still buys, but
    // rarely: a bargain is a bargain, not a mobilisation. Give it the army
    // that makes the difference — one city, four soldiers.
    const town = world.landNear(22, 22, 8);
    world.settle('Rival', town.col, town.row, 2, 1);
    for (let i = 0; i < 4; i++) soldier(world, 2, town.col + i, town.row, `rival-${i}`);
    rival.warWith = new Set();
    expect(threshold.call(nm, rival, 2), 'a peacetime court buys rarely').toBeGreaterThan(0.85);
    expect(threshold.call(nm, rival, 2)).toBeLessThanOrEqual(0.9);
  });
});
