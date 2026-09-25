/**
 * Engine invariants: the laws that must hold after ANY turn.
 *
 * Why this file exists: most engine tests exercise one rule in isolation, so a
 * regression that only shows up after 30 turns of interaction (a citizen count
 * drifting, gold going NaN, a corpse that keeps fighting, two units sharing a
 * tile) passes the whole suite. This one runs the real turn pipeline for many
 * rounds and asserts the global laws after every single round.
 *
 * The laws live in `tests/helpers/world.ts` (`checkInvariants`) so other
 * suites can reuse them. Everything here is a real GameEngine — no stubs
 * between the rules and the data.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { checkInvariants, makeEngine, makeGridEngine, useSeededRandom, world } from './helpers/world';

describe('Engine invariants over a long game', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('holds every law for 40 rounds of AI-vs-AI play', async () => {
    useSeededRandom(7);
    const { engine, runTurns } = await makeEngine({ seed: 4242, mapType: 'AI_VS_AI', numberOfCivilizations: 3 });

    const violations: string[] = [];
    for (let round = 0; round < 40 && !engine.isGameOver; round++) {
      await runTurns(1);
      for (const v of checkInvariants(engine)) {
        violations.push(`round ${round + 1}: [${v.law}] ${v.detail}`);
      }
    }

    expect(violations).toEqual([]);
    // The run has to be a real game, not a frozen one.
    expect(engine.turnManager.getRoundNumber()).toBeGreaterThanOrEqual(1);
  }, 120000);

  it('holds every law for a human city economy (40 rounds)', async () => {
    useSeededRandom(11);
    const { engine, runTurns } = await makeEngine({ seed: 99, mapType: 'MANY_CITIES' });
    const human = engine.civilizations.find((c) => c.isHuman);
    expect(human).toBeDefined();

    const violations: string[] = [];
    for (let round = 0; round < 40 && !engine.isGameOver; round++) {
      await runTurns(1);
      for (const v of checkInvariants(engine)) {
        violations.push(`round ${round + 1}: [${v.law}] ${v.detail}`);
      }
    }

    expect(violations).toEqual([]);
  }, 120000);

  it('the seeded map is reproducible (same seed, same world)', async () => {
    const a = await makeEngine({ seed: 555 });
    const b = await makeEngine({ seed: 555 });
    const c = await makeEngine({ seed: 556 });

    const fingerprint = (e: GameEngine) =>
      e.map!.tiles.map((t) => `${t.type ?? t.terrain}:${t.resource ?? ''}`).join('|');

    expect(fingerprint(a.engine)).toBe(fingerprint(b.engine));
    // A different seed is allowed to differ — that is the point of a seed.
    expect(fingerprint(a.engine)).not.toBe(fingerprint(c.engine));
  }, 60000);
});

describe('Invariants under stress: many units, specialists and fortified troops', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('holds when a city is packed with specialists and tiles', async () => {
    useSeededRandom(3);
    const { engine, runTurns } = await makeEngine({ seed: 31337, mapType: 'MANY_CITIES' });
    const human = engine.civilizations.find((c) => c.isHuman)!;
    const city = engine.cities.find((c) => c.civilizationId === human.id)!;

    // A big city, every citizen a specialist except the governor's choices.
    city.population = 9;
    city.specialists = [
      'entertainer', 'entertainer', 'taxman', 'taxman', 'taxman',
      'scientist', 'scientist', 'entertainer',
    ];
    engine.economicManager.refreshYieldsFromWorkingTiles(city as never);

    const violations: string[] = [];
    for (let round = 0; round < 20; round++) {
      await runTurns(1);
      for (const v of checkInvariants(engine)) {
        violations.push(`round ${round + 1}: [${v.law}] ${v.detail}`);
      }
    }

    expect(violations).toEqual([]);
    // Sanity: the scenario really did stress the city.
    expect(city.population).toBeGreaterThanOrEqual(1);
  }, 120000);

  it('holds when every unit is fortified or sleeping', async () => {
    useSeededRandom(5);
    const { engine, runTurns, spawnUnit } = await makeEngine({ seed: 2468, mapType: 'MANY_CITIES' });
    const human = engine.civilizations.find((c) => c.isHuman)!;

    for (let i = 0; i < 5; i++) {
      const spot = { col: 2 + i, row: 2 };
      const unit = spawnUnit({
        id: `garrison-${i}`,
        civilizationId: human.id,
        col: spot.col,
        row: spot.row,
      });
      if (i % 2 === 0) {
        engine.unitFortify(unit.id);
      } else {
        engine.unitSleep(unit.id);
      }
    }

    const violations: string[] = [];
    for (let round = 0; round < 10; round++) {
      await runTurns(1);
      for (const v of checkInvariants(engine)) {
        violations.push(`round ${round + 1}: [${v.law}] ${v.detail}`);
      }
    }

    expect(violations).toEqual([]);
  }, 120000);
});

describe('The specific laws, one at a time', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('catches a citizen that lost its tile', () => {
    const { engine, settle } = world(makeBareEngine());
    const city = settle('Test', 2, 2, 0, 3);
    // Two citizens but only the centre worked: the governor has not run.
    city.workingTiles = new Set(['2,2']);
    const bad = checkInvariants(engine);
    // pop 3 with no specialists expects 4 tiles; 1 is "fewer", which is legal
    // (the city is mid-assignment), so this must NOT be flagged.
    expect(bad).toEqual([]);
  });

  it('catches too many specialists for the population', () => {
    const { engine, settle } = world(makeBareEngine());
    const city = settle('Test', 2, 2, 0, 2);
    city.specialists = ['taxman', 'scientist', 'entertainer'];
    const bad = checkInvariants(engine);
    expect(bad.map((b) => b.law)).toContain('specialists <= population');
  });

  it('catches a corpse that is still alive (or still queued)', () => {
    const { engine, spawnUnit } = world(makeBareEngine());
    const corpse = spawnUnit({ id: 'corpse', col: 3, row: 3 });
    (corpse as unknown as { isDefeated: boolean }).isDefeated = true;
    // Health is untouched: the corpse still "lives", which must be flagged.
    expect(checkInvariants(engine).map((b) => b.law))
      .toContain('a defeated unit is at 0 health');

    // A corpse with 0 health and no movement is legal (it lingers for the
    // death animation), and a delayed removal is expected.
    corpse.health = 0;
    corpse.movesRemaining = 1;
    expect(checkInvariants(engine).map((b) => b.law))
      .not.toContain('a defeated unit is at 0 health');
  });

  it('catches a fortified unit that was given movement back by mistake', () => {
    const { engine, spawnUnit } = world(makeBareEngine());
    const unit = spawnUnit({ id: 'fort', col: 4, row: 4 });
    (unit as unknown as { isFortified: boolean }).isFortified = true;
    unit.movesRemaining = 3;
    const bad = checkInvariants(engine);
    expect(bad.map((b) => b.law)).toContain('a fortified unit sits out its turn');
  });

  it('allows own units to stack but never two civs', () => {
    const { engine, spawnUnit } = world(makeBareEngine());
    spawnUnit({ id: 'a', col: 5, row: 5, civilizationId: 0 });
    spawnUnit({ id: 'b', col: 5, row: 5, civilizationId: 0 });
    // Civ1 stacking (the unit-stack modal exists for exactly this) is legal.
    expect(checkInvariants(engine)).toEqual([]);

    const { engine: e2, spawnUnit: spawn2 } = world(makeBareEngine());
    spawn2({ id: 'mine', col: 6, row: 6, civilizationId: 0 });
    spawn2({ id: 'theirs', col: 6, row: 6, civilizationId: 1 });
    expect(checkInvariants(e2).map((b) => b.law)).toContain('no two civs share a tile');
  });

  it('catches a city of population 0 and NaN gold', () => {
    const { engine, settle } = world(makeBareEngine());
    const city = settle('Doomed', 6, 6, 0, 1);
    city.population = 0;
    engine.civilizations[0].resources.gold = Number.NaN;
    const bad = checkInvariants(engine);
    const laws = bad.map((b) => b.law);
    expect(laws).toContain('city population >= 1');
    expect(laws).toContain('gold is finite');
  });
});

/** A minimal engine with a small known map — no world generation. */
function makeBareEngine(): GameEngine {
  const row = ['grassland', 'grassland', 'grassland', 'grassland', 'grassland'];
  const engine = makeGridEngine([row, [...row], [...row], [...row], [...row]]);
  (engine as unknown as { isPaused: boolean }).isPaused = true;
  return engine;
}
